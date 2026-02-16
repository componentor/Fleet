import { Hono } from 'hono';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import userRoutes from './routes/users.js';
import serviceRoutes from './routes/services.js';
import deploymentRoutes from './routes/deployments.js';
import dnsRoutes from './routes/domains.js';
import nodeRoutes from './routes/nodes.js';
import billingRoutes from './routes/billing.js';
import terminalRoutes from './routes/terminal.js';
import sshRoutes from './routes/ssh.js';
import storageRoutes from './routes/storage.js';
import marketplaceRoutes from './routes/marketplace.js';
import backupRoutes from './routes/backups.js';
import emailRoutes from './routes/emails.js';
import domainPurchaseRoutes from './routes/domains-purchase.js';
import settingsRoutes from './routes/settings.js';
import adminRoutes from './routes/admin.js';
import updateRoutes from './routes/updates.js';
import setupRoutes from './routes/setup.js';

export const app = new Hono();

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API v1 routes
const api = new Hono();

api.route('/auth', authRoutes);
api.route('/accounts', accountRoutes);
api.route('/users', userRoutes);
api.route('/services', serviceRoutes);
api.route('/deployments', deploymentRoutes);
api.route('/dns', dnsRoutes);
api.route('/nodes', nodeRoutes);
api.route('/billing', billingRoutes);
api.route('/terminal', terminalRoutes);
api.route('/ssh', sshRoutes);
api.route('/storage', storageRoutes);
api.route('/marketplace', marketplaceRoutes);
api.route('/backups', backupRoutes);
api.route('/emails', emailRoutes);
api.route('/domains', domainPurchaseRoutes);
api.route('/settings', settingsRoutes);
api.route('/admin', adminRoutes);
api.route('/updates', updateRoutes);
api.route('/setup', setupRoutes);

app.route('/api/v1', api);

export type AppType = typeof app;
