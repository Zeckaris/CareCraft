import { Request, Response } from 'express';
import crypto from 'crypto';
import SibApiV3Sdk from 'sib-api-v3-sdk';

export const verificationCodes: Map<string, { code: string; expiresAt: Date }> = new Map();
export const mfaLoginCodes: Map<string, { code: string; expiresAt: Date }> = new Map();

// --- Setup Brevo client ---
const client = new SibApiV3Sdk.TransactionalEmailsApi();
SibApiV3Sdk.ApiClient.instance.authentications['api-key'].apiKey = process.env.BREVO_API_KEY!;

export const validateEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

export const validateVerificationCode = (email: string, providedCode: string): { success: boolean; message: string } => {
  const stored = verificationCodes.get(email);
  if (!stored) return { success: false, message: 'No verification code found for this email.' };
  if (new Date() > stored.expiresAt) {
    verificationCodes.delete(email);
    return { success: false, message: 'Verification code expired. Request a new one.' };
  }
  if (stored.code !== providedCode) return { success: false, message: 'Invalid verification code.' };

  verificationCodes.delete(email);
  return { success: true, message: 'Email verified!' };
};

export const validateMfaLoginCode = (email: string, providedCode: string): { success: boolean; message: string } => {
  const stored = mfaLoginCodes.get(email);
  if (!stored) return { success: false, message: 'No MFA code found. Please request login again.' };
  if (new Date() > stored.expiresAt) {
    mfaLoginCodes.delete(email);
    return { success: false, message: 'MFA code expired. Please try logging in again.' };
  }
  if (stored.code !== providedCode) return { success: false, message: 'Invalid MFA code.' };

  mfaLoginCodes.delete(email);
  return { success: true, message: 'MFA verified successfully!' };
};

// --- Send MFA login code ---
export const sendMfaLoginCode = async (email: string): Promise<boolean> => {
  const code = crypto.randomBytes(3).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  mfaLoginCodes.set(email, { code, expiresAt });

  try {
    await client.sendTransacEmail({
      sender: { email: process.env.EMAIL_FROM!, name: 'CareCraft' },
      to: [{ email }],
      subject: 'CareCraft Login Verification Code',
      htmlContent: `
        <h2>Login Verification Required</h2>
        <p>Your login verification code is: <strong style="font-size: 24px;">${code}</strong></p>
        <p><strong>Expires in 10 minutes</strong></p>
        <p>Use this code to complete your login.</p>
        <p>If you didn't attempt to log in, please ignore this email and consider enabling MFA in settings.</p>
      `,
    });
    return true;
  } catch (error) {
    console.error('MFA login code email error:', error);
    mfaLoginCodes.delete(email);
    return false;
  }
};

// --- Cleanup functions ---
export const cleanupExpiredCodes = () => {
  const now = new Date();
  for (const [email] of verificationCodes.entries()) {
    if (now > verificationCodes.get(email)!.expiresAt) verificationCodes.delete(email);
  }
};

export const cleanupExpiredMfaCodes = () => {
  const now = new Date();
  for (const [email] of mfaLoginCodes.entries()) {
    if (now > mfaLoginCodes.get(email)!.expiresAt) mfaLoginCodes.delete(email);
  }
};

export const startVerificationCleanup = () => {
  console.log('verification cleanup done');
  setInterval(() => {
    cleanupExpiredCodes();
    cleanupExpiredMfaCodes();
  }, 180 * 1000);
  cleanupExpiredCodes();
  cleanupExpiredMfaCodes();
};

// --- Send Invite Email ---
export const sendInviteEmail = async (to: string, token: string, role: string): Promise<void> => {
  const inviteLink = `${process.env.APP_URL}/signup?token=${token}`;
  await client.sendTransacEmail({
    sender: { email: process.env.EMAIL_FROM!, name: 'CareCraft' },
    to: [{ email: to }],
    subject: `CareCraft ${role} Invitation`,
    htmlContent: `<a href="${inviteLink}">Click to Signup</a><br>Token: ${token}<br>Expires in 3 min.`,
  });
};

// --- Middleware to send invite token ---
export const sendInviteToken = async (req: Request, res: Response, next: any) => {
  const { targetEmail } = req.body;

  if (!validateEmail(targetEmail)) return res.status(400).json({ message: 'Invalid email format' });

  try {
    await sendInviteEmail(targetEmail, req.body.token, req.body.role);
    next();
  } catch (error) {
    console.error('Invite email error:', error);
    res.status(500).json({ message: 'Email failed' });
  }
};
