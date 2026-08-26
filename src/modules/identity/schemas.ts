import { z } from "zod";

export const loginSchema = z.object({
  phone: z.string().min(1).max(30),
  password: z.string().min(1).max(128),
}).strict();

export const firstPasswordChangeSchema = z.object({
  newPassword: z.string().min(1).max(128),
  confirmPassword: z.string().min(1).max(128),
  confidentialityConfirm: z.literal(true),
}).strict().superRefine((value, context) => {
  if (value.newPassword !== value.confirmPassword) {
    context.addIssue({ code: "custom", path: ["confirmPassword"], message: "两次输入的密码不一致" });
  }
});

export const changePasswordSchema = z.object({
  oldPassword: z.string().max(128).optional(),
  newPassword: z.string().min(1).max(128),
  confirmPassword: z.string().min(1).max(128),
}).strict().superRefine((value, context) => {
  if (value.newPassword !== value.confirmPassword) {
    context.addIssue({ code: "custom", path: ["confirmPassword"], message: "两次输入的密码不一致" });
  }
});
