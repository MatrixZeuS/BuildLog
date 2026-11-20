import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { requireFirebaseAuth, type AuthenticatedRequest } from './firebaseAuth';
import {
  acknowledgePendingEvents,
  acquireWebhookDeliveryLease,
  completeWebhookDeliveryLease,
  consumePendingAuthState,
  createPendingAuthState,
  DEFAULT_WEBHOOK_LEASE_MS,
  enqueuePendingWebhookEvents,
  getPendingEventsAndDeliveriesForUser,
  getUserGitHubSession,
  grantUserVerifiedInstallations,
  purgeOwnerServerState,
  recordWebhookDelivery,
  releaseWebhookDeliveryLease,
  removeInstallationMapping,
  renewWebhookDeliveryLease,
  resolveWebhookTarget,
  saveUserGitHubSession,
  upsertInstallationMapping,
  userOwnsInstallationOnServer,
  type ServerRepositoryMapping,
} from './webhookStore';
import {
  buildGitHubAppInstallUrl,
  buildGitHubOAuthAuthorizeUrl,
  exchangeGitHubOAuthCode,
  fetchAuthorizedGitHubUserAndInstallations,
  fetchRepositoryRecentHistory,
  getGitHubAppConfigStatus,
  verifyInstallationContainsRepository,
} from './githubApp';
import {
  summarizeRepositoryActivity,
  type SummarizerEventInput,
} from './geminiSummarizer';
import {
  normalizeGitHubWebhookPayload,
  verifyGitHubWebhookSignature,
} from '../utils/githubNormalization';
import { parseGitHubRepositoryUrl } from '../utils/githubUrl';

export function createApp(): express.Express {
  const app = express();

  // 1. GitHub Webhook Endpoint MUST read raw body BEFORE express.json() for HMAC-SHA256 verification
  app.post(
    '/api/webhooks/github',
    express.raw({ type: ['application/json', 'application/*+json'], limit: '2mb' }),
    async (req: Request, res: Response) => {
      const webhookSecret = (process.env.GITHUB_WEBHOOK_SECRET ?? '').trim();
      const signature = req.header('x-hub-signature-256');
      const deliveryIdHeader = (req.header('x-github-delivery') || '').trim();
      const eventType = req.header('x-github-event') || '';

      if (!webhookSecret) {
        res.status(503).json({
          error: 'GITHUB_WEBHOOK_SECRET is not configured on the server.',
        });
        return;
      }

      const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));

      // Signature verification MUST run before claiming or touching any delivery lease
      if (!verifyGitHubWebhookSignature(rawBody, signature, webhookSecret)) {
        res.status(401).json({ error: 'Invalid GitHub webhook signature.' });
        return;
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
      } catch {
        res.status(400).json({ error: 'Malformed JSON webhook payload.' });
        return;
      }

      const effectiveDeliveryId =
        deliveryIdHeader ||
        (eventType === 'ping' ? `ping-${crypto.randomUUID()}` : crypto.randomUUID());

      const lease = await acquireWebhookDeliveryLease(effectiveDeliveryId);

      if (lease.status === 'already_completed') {
        res.status(200).json({
          ok: true,
          status: 'duplicate_ignored',
          deliveryId: deliveryIdHeader || effectiveDeliveryId,
        });
        return;
      }

      if (lease.status === 'in_progress') {
        res.status(409).json({
          ok: false,
          status: 'in_progress',
          deliveryId: deliveryIdHeader || effectiveDeliveryId,
          leaseExpiresAt: lease.leaseExpiresAt,
          error: 'Webhook delivery is currently being processed by another worker.',
        });
        return;
      }

      const leaseToken = lease.leaseToken;
      let finalized = false;
      const renewalState: { lost: boolean; inFlight: Promise<void> | null } = {
        lost: false,
        inFlight: null,
      };

      const renewalIntervalMs = Math.max(5_000, Math.floor(DEFAULT_WEBHOOK_LEASE_MS / 3));
      const renewalTimer = setInterval(() => {
        if (finalized || renewalState.lost) return;
        renewalState.inFlight = renewWebhookDeliveryLease(effectiveDeliveryId, leaseToken)
          .then((result) => {
            if (!result.renewed) {
              renewalState.lost = true;
            }
          })
          .catch(() => {
            // Transient renewal errors will still be caught by conditional completion
          });
      }, renewalIntervalMs);
      if (typeof renewalTimer.unref === 'function') {
        renewalTimer.unref();
      }

      try {
        if (eventType === 'ping') {
          await recordWebhookDelivery({
            deliveryId: deliveryIdHeader || effectiveDeliveryId,
            eventType: 'ping',
            repositoryFullName: String((payload.repository as { full_name?: string })?.full_name ?? ''),
            installationId: String((payload.installation as { id?: number })?.id ?? ''),
            receivedAt: new Date().toISOString(),
            processingStatus: 'recorded_without_summary',
            eventCount: 0,
          });

          const completion = await completeWebhookDeliveryLease(
            effectiveDeliveryId,
            leaseToken,
            'pong'
          );
          if (!completion.completed) {
            if (completion.reason === 'already_completed') {
              finalized = true;
              res.status(200).json({
                ok: true,
                status: 'duplicate_ignored',
                deliveryId: deliveryIdHeader || effectiveDeliveryId,
              });
              return;
            }
            res.status(409).json({
              ok: false,
              status: completion.reason ?? 'lease_lost',
              error: 'Webhook delivery lease expired or was superseded before completion.',
            });
            return;
          }

          finalized = true;
          res.status(200).json({ ok: true, status: 'pong' });
          return;
        }

        const normalized = normalizeGitHubWebhookPayload(
          eventType,
          deliveryIdHeader || effectiveDeliveryId,
          payload
        );

        if (!normalized.supported) {
          const completion = await completeWebhookDeliveryLease(
            effectiveDeliveryId,
            leaseToken,
            'ignored_unsupported_event'
          );
          if (!completion.completed) {
            if (completion.reason === 'already_completed') {
              finalized = true;
              res.status(200).json({
                ok: true,
                status: 'duplicate_ignored',
                deliveryId: deliveryIdHeader || effectiveDeliveryId,
              });
              return;
            }
            res.status(409).json({
              ok: false,
              status: completion.reason ?? 'lease_lost',
              error: 'Webhook delivery lease expired or was superseded before completion.',
            });
            return;
          }

          finalized = true;
          res.status(202).json({
            ok: true,
            status: 'ignored_unsupported_event',
            eventType,
          });
          return;
        }

        const target = await resolveWebhookTarget(
          normalized.installationId,
          normalized.githubRepositoryId,
          normalized.repositoryFullName
        );

        if (!target) {
          await recordWebhookDelivery({
            deliveryId: deliveryIdHeader || effectiveDeliveryId,
            eventType,
            repositoryFullName: normalized.repositoryFullName,
            installationId: normalized.installationId,
            receivedAt: new Date().toISOString(),
            processingStatus: 'unmapped_repository',
            eventCount: normalized.events.length,
            errorMessage: 'Repository is not linked to an active BuildLog workspace.',
          });

          const completion = await completeWebhookDeliveryLease(
            effectiveDeliveryId,
            leaseToken,
            'unmapped_repository'
          );
          if (!completion.completed) {
            if (completion.reason === 'already_completed') {
              finalized = true;
              res.status(200).json({
                ok: true,
                status: 'duplicate_ignored',
                deliveryId: deliveryIdHeader || effectiveDeliveryId,
              });
              return;
            }
            res.status(409).json({
              ok: false,
              status: completion.reason ?? 'lease_lost',
              error: 'Webhook delivery lease expired or was superseded before completion.',
            });
            return;
          }

          finalized = true;
          res.status(202).json({
            ok: true,
            status: 'unmapped_repository',
            repository: normalized.repositoryFullName,
          });
          return;
        }

        if (target.status !== 'active') {
          await recordWebhookDelivery({
            deliveryId: deliveryIdHeader || effectiveDeliveryId,
            eventType,
            repositoryFullName: normalized.repositoryFullName,
            installationId: normalized.installationId,
            receivedAt: new Date().toISOString(),
            processingStatus: 'duplicate_ignored',
            eventCount: 0,
            errorMessage: `Repository tracking status is ${target.status}.`,
          });

          const completion = await completeWebhookDeliveryLease(
            effectiveDeliveryId,
            leaseToken,
            'repository_not_active'
          );
          if (!completion.completed) {
            if (completion.reason === 'already_completed') {
              finalized = true;
              res.status(200).json({
                ok: true,
                status: 'duplicate_ignored',
                deliveryId: deliveryIdHeader || effectiveDeliveryId,
              });
              return;
            }
            res.status(409).json({
              ok: false,
              status: completion.reason ?? 'lease_lost',
              error: 'Webhook delivery lease expired or was superseded before completion.',
            });
            return;
          }

          finalized = true;
          res.status(200).json({
            ok: true,
            status: 'repository_not_active',
          });
          return;
        }

        if (renewalState.lost) {
          res.status(409).json({
            ok: false,
            status: 'lease_lost',
            error: 'Webhook delivery lease was lost prior to queuing events.',
          });
          return;
        }

        const nowIso = new Date().toISOString();
        await enqueuePendingWebhookEvents(
          normalized.events.map((ev) => ({
            queueId: `${deliveryIdHeader || effectiveDeliveryId}:${ev.eventId}`,
            ownerId: target.ownerId,
            repositoryId: target.repositoryId,
            githubRepositoryId: normalized.githubRepositoryId,
            repositoryFullName: normalized.repositoryFullName,
            deliveryId: deliveryIdHeader || 'manual',
            payload: ev,
            receivedAt: nowIso,
          }))
        );

        await recordWebhookDelivery({
          deliveryId: deliveryIdHeader || effectiveDeliveryId,
          eventType,
          repositoryFullName: normalized.repositoryFullName,
          installationId: normalized.installationId,
          receivedAt: nowIso,
          processingStatus: 'pending',
          eventCount: normalized.events.length,
        });

        if (renewalState.inFlight) {
          await renewalState.inFlight.catch(() => {});
        }

        // Complete the lease ONLY after all pending events and the delivery log are persisted
        const completion = await completeWebhookDeliveryLease(
          effectiveDeliveryId,
          leaseToken,
          `queued_${normalized.events.length}`
        );
        if (!completion.completed) {
          if (completion.reason === 'already_completed') {
            finalized = true;
            res.status(200).json({
              ok: true,
              status: 'duplicate_ignored',
              deliveryId: deliveryIdHeader || effectiveDeliveryId,
            });
            return;
          }
          res.status(409).json({
            ok: false,
            status: completion.reason ?? 'lease_lost',
            error: 'Webhook delivery lease expired or was lost before completion.',
          });
          return;
        }

        finalized = true;
        res.status(202).json({
          ok: true,
          status: 'queued',
          eventCount: normalized.events.length,
        });
      } catch (error) {
        finalized = true;
        await releaseWebhookDeliveryLease(effectiveDeliveryId, leaseToken).catch(() => {});
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to process GitHub webhook delivery.',
        });
      } finally {
        clearInterval(renewalTimer);
        if (!finalized) {
          await releaseWebhookDeliveryLease(effectiveDeliveryId, leaseToken).catch(() => {});
        }
      }
    }
  );

  // 2. Standard JSON middleware for all authenticated API routes
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      github: getGitHubAppConfigStatus(),
    });
  });

  app.get(
    '/api/github/status',
    requireFirebaseAuth,
    (_req: AuthenticatedRequest, res: Response) => {
      res.json(getGitHubAppConfigStatus());
    }
  );

  app.post(
    '/api/github/repositories/prepare-connect',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.uid!;
      const repositoryUrl = String(req.body?.repositoryUrl ?? '');
      const parsed = parseGitHubRepositoryUrl(repositoryUrl);

      if (!parsed.valid) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const config = getGitHubAppConfigStatus();
      if (!config.configured || !config.oauthConfigured || !config.webhookConfigured) {
        res.status(503).json({
          error:
            "GitHub repository connection is not configured on this server yet, so projects can't be added. Ask whoever runs this BuildLog to finish setup (see Technical details on this page).",
          missingEnvVars: config.missingEnvVars,
        });
        return;
      }

      try {
        // Check ONLY installations verified for the currently authorized GitHub user of this BuildLog account
        const session = await getUserGitHubSession(uid);
        if (session?.accessToken) {
          try {
            const liveUser = await fetchAuthorizedGitHubUserAndInstallations(session.accessToken);
            await grantUserVerifiedInstallations(uid, liveUser.installationIds);

            for (const instId of liveUser.installationIds) {
              const check = await verifyInstallationContainsRepository(
                instId,
                parsed.fullName
              ).catch(() => null);

              if (check && check.found) {
                res.json({
                  status: 'authorized',
                  fullName: check.repository.fullName,
                  installationId: check.installationId,
                  accountName: check.accountName,
                  repository: check.repository,
                  alreadyAuthorized: true,
                });
                return;
              }
            }
          } catch {
            // Stored user token expired or revoked; fall through to fresh GitHub authorization
          }
        }

        const stateToken = await createPendingAuthState(uid, parsed.fullName);
        const authorizeUrl = buildGitHubAppInstallUrl(stateToken);
        res.json({
          status: 'authorization_required',
          fullName: parsed.fullName,
          authorizeUrl,
        });
      } catch (error) {
        res.status(502).json({
          error:
            error instanceof Error
              ? error.message
              : 'Unable to check GitHub repository authorization.',
        });
      }
    }
  );

  app.post(
    '/api/github/repositories/complete-authorization',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.uid!;
      const stateToken = String(req.body?.state ?? '').trim();
      const code = String(req.body?.code ?? '').trim();
      const rawInstallationId = String(req.body?.installationId ?? '').trim();
      const redirectUri = String(req.body?.redirectUri ?? '').trim();

      const pending = await consumePendingAuthState(uid, stateToken);
      if (!pending) {
        res.status(400).json({
          error:
            'That took too long, or you signed in with a different account. Paste the project link and try again.',
        });
        return;
      }

      const targetInstallationId = rawInstallationId || pending.pendingInstallationId || '';
      if (targetInstallationId && !/^[a-zA-Z0-9_-]{1,64}$/.test(targetInstallationId)) {
        res.status(400).json({ error: 'Invalid GitHub installation parameter returned.' });
        return;
      }

      const config = getGitHubAppConfigStatus();
      if (!config.configured || !config.oauthConfigured) {
        res.status(503).json({
          error: "GitHub connections aren't set up on this BuildLog yet. Ask whoever runs it to finish setup.",
          missingEnvVars: config.missingEnvVars,
        });
        return;
      }

      try {
        let verifiedUser: {
          githubUserId: string;
          githubLogin: string;
          installationIds: string[];
        } | null = null;

        if (code) {
          const accessToken = await exchangeGitHubOAuthCode(code, redirectUri || undefined);
          verifiedUser = await fetchAuthorizedGitHubUserAndInstallations(accessToken);
          await saveUserGitHubSession({
            uid,
            githubUserId: verifiedUser.githubUserId,
            githubLogin: verifiedUser.githubLogin,
            accessToken,
            verifiedInstallationIds: verifiedUser.installationIds,
          });
        } else {
          const existingSession = await getUserGitHubSession(uid);
          if (existingSession?.accessToken) {
            try {
              verifiedUser = await fetchAuthorizedGitHubUserAndInstallations(
                existingSession.accessToken
              );
              await grantUserVerifiedInstallations(uid, verifiedUser.installationIds);
            } catch {
              verifiedUser = null;
            }
          }
        }

        // If we do not yet have a verified GitHub user identity, request OAuth identity verification
        if (!verifiedUser) {
          const nextState = await createPendingAuthState(
            uid,
            pending.targetFullName,
            targetInstallationId || undefined
          );
          const fallbackRedirect =
            redirectUri ||
            (process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/integrations` : '');
          res.json({
            status: 'oauth_verification_required',
            fullName: pending.targetFullName,
            authorizeUrl: buildGitHubOAuthAuthorizeUrl(nextState, fallbackRedirect),
          });
          return;
        }

        if (targetInstallationId) {
          if (!verifiedUser.installationIds.includes(targetInstallationId)) {
            res.status(403).json({
              error: `You're signed in to GitHub as @${verifiedUser.githubLogin}, but that access belongs to a different account. Sign in to GitHub with the right account and try again.`,
            });
            return;
          }

          const check = await verifyInstallationContainsRepository(
            targetInstallationId,
            pending.targetFullName
          );

          if (!check.found) {
            res.status(403).json({
              error: `BuildLog wasn't given access to "${pending.targetFullName}". Click Try again, then on GitHub make sure this project is selected.`,
            });
            return;
          }

          res.json({
            status: 'authorized',
            fullName: check.repository.fullName,
            installationId: check.installationId,
            accountName: check.accountName,
            githubLogin: verifiedUser.githubLogin,
            repository: check.repository,
          });
          return;
        }

        for (const instId of verifiedUser.installationIds) {
          const check = await verifyInstallationContainsRepository(
            instId,
            pending.targetFullName
          ).catch(() => null);
          if (check && check.found) {
            res.json({
              status: 'authorized',
              fullName: check.repository.fullName,
              installationId: check.installationId,
              accountName: check.accountName,
              githubLogin: verifiedUser.githubLogin,
              repository: check.repository,
            });
            return;
          }
        }

        res.status(403).json({
          error: `BuildLog doesn't have access to "${pending.targetFullName}" yet. Click Try again, then on GitHub choose this project.`,
        });
      } catch (error) {
        res.status(502).json({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to verify GitHub authorization on the server.',
        });
      }
    }
  );

  app.post(
    '/api/github/installations/sync-mapping',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.uid!;
      const installationId = String(req.body?.installationId ?? '').trim();
      const integrationId = String(req.body?.integrationId ?? '').trim();
      const accountName = String(req.body?.accountName ?? '').trim() || 'github';
      const repositories = Array.isArray(req.body?.repositories)
        ? (req.body.repositories as ServerRepositoryMapping[])
        : [];

      if (!installationId || !integrationId) {
        res.status(400).json({ error: 'installationId and integrationId are required.' });
        return;
      }

      try {
        const ownsInstallation = await userOwnsInstallationOnServer(uid, installationId);
        if (!ownsInstallation) {
          res.status(403).json({
            error: "You don't have permission to set up live updates for this GitHub account.",
          });
          return;
        }

        await upsertInstallationMapping({
          installationId,
          ownerId: uid,
          integrationId,
          accountName,
          repositories,
        });

        res.json({ ok: true });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to sync installation mapping.';
        const statusCode = message.includes('already registered to another BuildLog account')
          ? 403
          : 500;
        res.status(statusCode).json({ error: message });
      }
    }
  );

  app.post(
    '/api/github/repositories/import',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.uid!;
      const installationId = String(req.body?.installationId ?? '').trim();
      const fullName = String(req.body?.fullName ?? '').trim();
      const defaultBranch = String(req.body?.defaultBranch ?? 'main').trim() || 'main';

      if (!installationId || !fullName) {
        res.status(400).json({ error: 'installationId and fullName are required.' });
        return;
      }

      const ownsInstallation = await userOwnsInstallationOnServer(uid, installationId);
      if (!ownsInstallation) {
        res.status(403).json({
          error: "You don't have permission to copy activity from this GitHub account.",
        });
        return;
      }

      const config = getGitHubAppConfigStatus();
      if (!config.configured) {
        res.status(503).json({
          error: "GitHub connections aren't set up on this BuildLog yet. Ask whoever runs it to finish setup.",
        });
        return;
      }

      try {
        const events = await fetchRepositoryRecentHistory(
          installationId,
          fullName,
          defaultBranch
        );
        res.json({ events });
      } catch (error) {
        res.status(502).json({
          error:
            error instanceof Error
              ? error.message
              : 'Unable to fetch recent repository history from GitHub.',
        });
      }
    }
  );

  app.delete(
    '/api/github/installations/:installationId',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const uid = req.uid!;
        const installationId = String(req.params.installationId ?? '').trim();
        if (installationId) {
          await removeInstallationMapping(uid, installationId);
        }
        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to remove installation mapping.',
        });
      }
    }
  );

  app.get(
    '/api/ingestion/pending',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const uid = req.uid!;
        const result = await getPendingEventsAndDeliveriesForUser(uid);
        res.json(result);
      } catch (error) {
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to load pending webhook events.',
        });
      }
    }
  );

  app.post(
    '/api/ingestion/ack',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const uid = req.uid!;
        const queueIds = Array.isArray(req.body?.queueIds)
          ? req.body.queueIds.map(String)
          : [];
        const acknowledged = await acknowledgePendingEvents(uid, queueIds);
        res.json({ ok: true, acknowledged });
      } catch (error) {
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to acknowledge pending webhook events.',
        });
      }
    }
  );

  app.post(
    '/api/summarize',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const uid = req.uid!;
      const repositoryFullName = String(req.body?.repositoryFullName ?? '').trim();
      const events = Array.isArray(req.body?.events)
        ? (req.body.events as SummarizerEventInput[])
        : [];

      if (!repositoryFullName || events.length === 0) {
        res.status(400).json({ error: 'repositoryFullName and events array are required.' });
        return;
      }

      try {
        const result = await summarizeRepositoryActivity(uid, repositoryFullName, events);
        res.json(result);
      } catch (error) {
        res.status(502).json({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to summarize repository activity.',
        });
      }
    }
  );

  app.delete(
    '/api/account/data',
    requireFirebaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const uid = req.uid!;
        await purgeOwnerServerState(uid);
        res.json({ ok: true });
      } catch (error) {
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : 'Failed to purge account server state.',
        });
      }
    }
  );

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  return app;
}

export const app = createApp();
export default app;
