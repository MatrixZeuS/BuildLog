import type { NextFunction, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { getAdminApp } from './firebaseAdmin';

export interface AuthenticatedRequest extends Request {
  uid?: string;
  userEmail?: string;
}

export async function requireFirebaseAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Authentication required. Missing Bearer Firebase ID token.',
    });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Authentication token is empty.' });
    return;
  }

  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(token);
    req.uid = decoded.uid;
    req.userEmail = decoded.email;
    next();
  } catch (error) {
    console.error('Firebase token verification failed:', error);
    res.status(401).json({
      error: 'Invalid or expired Firebase authentication token.',
    });
  }
}
