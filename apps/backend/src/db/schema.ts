import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { userRoleSchema, type UserRole } from '@locternos/shared';

// Zod's `.options` is typed as a plain array; drizzle needs a non-empty tuple.
const userRoles = userRoleSchema.options as [UserRole, ...UserRole[]];

/** Panel accounts. Phase 1 only has the single Admin created on first run. */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: userRoles }).notNull().default('admin'),
  createdAt: text('created_at').notNull(),
});
