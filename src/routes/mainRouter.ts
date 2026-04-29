// src/routes/mainRouter.ts
// ──────────────────────────────────────────────
// ศูนย์รวม API Routes ทั้งหมดของระบบ
// จัดการ endpoint ได้ง่ายโดยแยกตามกลุ่ม
// ──────────────────────────────────────────────
import express from 'express';

import statsRoutes from './stats.js';
import conversationsRoutes from './conversations.js';
import ticketsRoutes from './tickets.js';
import usersRoutes from './users.js';
import notificationsRoutes from './notifications.js';

const mainRouter = express.Router();

// ──────────────────────────────────────────────
// Route Mapping
// ──────────────────────────────────────────────
// | Path                  | File               |
// |-----------------------|--------------------|
// | /api/stats/*          | stats.ts           |
// | /api/conversations/*  | conversations.ts   |
// | /api/tickets/*        | tickets.ts         |
// | /api/users/*          | users.ts           |
// | /api/notifications/*  | notifications.ts   |
// ──────────────────────────────────────────────

mainRouter.use('/stats', statsRoutes);
mainRouter.use('/conversations', conversationsRoutes);
mainRouter.use('/tickets', ticketsRoutes);
mainRouter.use('/users', usersRoutes);
mainRouter.use('/notifications', notificationsRoutes);

export default mainRouter;
