import type { Request, Response } from 'express';
import { config, googleConfigured } from '../config';
import { deviceId } from '../lib/network';
import { authEnabled } from '../services/authService';
import { currentUser } from '../services/accounts';
import * as google from './google';

/**
 * Connected services. Opening EventControl never needs an account; connecting a service
 * is optional and personal. Each provider says whether the server is set up for it,
 * whether this browser (or, in private mode, this installation) is connected, and what
 * the connection unlocks. A new provider (e.g. GitHub, OneDrive) adds an entry here plus
 * its own OAuth start/callback and feature routes, the way Google does.
 */

export interface ServiceStatus {
  id: string;
  name: string;
  description: string;
  /** Features the connection unlocks in the app. */
  features: { id: string; name: string; available: boolean }[];
  configured: boolean;
  connected: boolean;
  account: { email: string; name: string; picture: string | null } | null;
  /** Where the browser goes to connect (a full-page redirect to the provider). */
  connectPath: string;
  disconnectPath: string;
}

/**
 * Who a connection belongs to. Accounts: the signed-in person. Open access (no sign-in):
 * the browser that connected it, so opening the shared link never exposes someone else's
 * account.
 */
export const connectionOwner = (req: Request, res: Response) => {
  if (!authEnabled()) return `device:${deviceId(req, res)}`;
  const user = currentUser();
  return user ? `user:${user.id}` : 'installation';
};

export const googleSignInEnabled = () => authEnabled() && googleConfigured() && config.google.allowedEmails.length > 0;

interface Provider {
  id: string;
  status: (owner: string) => Promise<ServiceStatus>;
}

const providers: Provider[] = [
  {
    id: 'google',
    async status(owner) {
      const s = await google.status(owner, googleSignInEnabled());
      return {
        id: 'google',
        name: 'Google',
        description: 'Pick PowerPoint, Google Slides and PDF files in Google’s own window and import them. EventControl only opens the files you pick.',
        features: [{ id: 'drive', name: 'Google Drive', available: s.connected && s.drive }],
        configured: s.configured,
        connected: s.connected,
        account: s.account ? { email: s.account.email, name: s.account.name, picture: s.account.picture } : null,
        connectPath: '/api/integrations/google/connect',
        disconnectPath: '/api/integrations/google/disconnect',
      };
    },
  },
];

export async function listServices(req: Request, res: Response) {
  const owner = connectionOwner(req, res);
  res.json(await Promise.all(providers.map((p) => p.status(owner))));
}
