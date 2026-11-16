import { z } from 'zod';
import { userRoleSchema } from './enums.js';

export const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  role: userRoleSchema,
  createdAt: z.string().datetime(),
});
export type User = z.infer<typeof userSchema>;
