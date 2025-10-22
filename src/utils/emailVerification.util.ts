import nodemailer from 'nodemailer';
import { Request, Response } from 'express';

export const verificationCodes: Map<string, { code: string; expiresAt: Date }> = new Map();

export const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

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


export const cleanupExpiredCodes = () => {
  const now = new Date();
  for (const [email] of verificationCodes.entries()) {
    if (now > verificationCodes.get(email)!.expiresAt) {
      verificationCodes.delete(email);
    }
  }
};

export const startVerificationCleanup = () => {
  console.log('verification cleanup done')
  setInterval(cleanupExpiredCodes, 180 * 1000);
  cleanupExpiredCodes(); 
};

export const sendInviteEmail = async (to: string, token: string, role: string): Promise<void> => {
  const inviteLink = `${process.env.APP_URL}/signup?token=${token}`;
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject: `CareCraft ${role} Invitation`,
    html: `<a href="${inviteLink}">Click to Signup</a><br>Token: ${token}<br>Expires in 3 min.`,
  });
};



export const sendInviteToken = async (req: Request, res: Response, next: any) => {
  const { targetEmail } = req.body;
  
  if (!validateEmail(targetEmail)) {
    return res.status(400).json({ message: 'Invalid email format' });
  }
  
  try {
    await sendInviteEmail(targetEmail, req.body.token, req.body.role);
    next();
  } catch (error) {
    res.status(500).json({ message: 'Email failed' });
  }
};