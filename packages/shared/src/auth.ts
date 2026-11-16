import { z } from 'zod';
import { userSchema } from './user.js';

/** Emails are trimmed and lowercased so lookups are case-insensitive. */
const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const setupStatusSchema = z.object({
  setupRequired: z.boolean(),
});
export type SetupStatus = z.infer<typeof setupStatusSchema>;

export const setupRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(256),
});
export type SetupRequest = z.infer<typeof setupRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Returned by setup, login and the current-session endpoint. */
export const sessionResponseSchema = z.object({
  user: userSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
