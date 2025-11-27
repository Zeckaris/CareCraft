import { Request, Response } from 'express';
import UserAccount from '../../models/userAccount.model.ts'
import { Student } from '../../models/student.model.ts';
import { InviteToken } from '../../models/inviteToken.model.ts';
import bcrypt from 'bcrypt'
import { generateToken, prepareUserData } from '../../utils/auth.util.ts';
import mongoose from 'mongoose';
import { validateEmail, sendInviteEmail, validateVerificationCode, verificationCodes, transporter } from '../../utils/emailVerification.util'
import crypto from 'crypto';
import { sendResponse } from '../../utils/sendResponse.util.ts';


interface SignupRequestBody {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: string;
  phoneNumber: string;
  inviteToken?: string;
  verificationCode: string;
}



export const sendVerification = async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) return sendResponse(res, 400, false, 'Email required.');

  if (!validateEmail(email)) {
    return sendResponse(res, 400, false, 'Invalid email format.');
  }

  const code = crypto.randomBytes(3).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  verificationCodes.set(email, { code, expiresAt });

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'CareCraft Email Verification',
      html: `
        <h2>Verify Your Email</h2>
        <p>Your verification code is: <strong>${code}</strong></p>
        <p><strong>Expires in 10 minutes</strong></p>
        <p>Enter this code on the signup page to continue.</p>
      `,
    });
     sendResponse(res, 200, true, 'Verification code sent! Check your inbox.');
  } catch (error) {
    console.error('Email error:', error);
    verificationCodes.delete(email);
    sendResponse(res, 500, false, 'Failed to send verification email.');
  }
};


export const signupUser = async (req: Request, res: Response): Promise<void> => {
  const { firstName, lastName, email, password, phoneNumber, inviteToken, verificationCode} =
    req.body as SignupRequestBody;

  if (!firstName || !lastName || !email || !password || !phoneNumber) {
    sendResponse(res, 400, false, 'Missing required fields.');
    return;
  }

  try {
    const existingUser = await UserAccount.findOne({ email });
    if (existingUser) {
      sendResponse(res, 400, false, 'User already exists.');
      return;
    }
    const codeValidation = validateVerificationCode(email, verificationCode);
    if (!codeValidation.success) {
      sendResponse(res, 400, false, codeValidation.message);
      return;
    }
    let studentToAssociate = null;

    if (!inviteToken) {
      sendResponse(res, 400, false, 'Invite token is required for all Users.');
      return;
    }

    const tokenRecord = await InviteToken.findOne({ token: inviteToken });
    if (!tokenRecord) {
      sendResponse(res, 400, false, 'Invalid invite token.');
      return;
    }
    const role = tokenRecord.role;
    if (tokenRecord.role !== role) {
      sendResponse(res, 400, false, 'Invite token role mismatch.');
      return;
    }
    if (tokenRecord.isUsed || tokenRecord.expiresAt < new Date()) {
      sendResponse(res, 400, false, 'Invite token is expired or already used.');
      return;
    }

    if (role === 'parent') {
      if (!tokenRecord.createdFor) {
        sendResponse(res, 400, false, 'No student associated with this invite token.');
        return;
      }
      studentToAssociate = await Student.findById(tokenRecord.createdFor);
      if (!studentToAssociate) {
        sendResponse(res, 404, false, 'Associated student not found.');
        return;
      }
    }

    tokenRecord.isUsed = true;
    await tokenRecord.save();

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await UserAccount.create({
      firstName,
      lastName,
      email,
      password: hashedPassword,
      role,
      phoneNumber,
    });

    if (studentToAssociate) {
      studentToAssociate.parentId = new mongoose.Types.ObjectId(newUser._id);
      await studentToAssociate.save();
    }

    const token = generateToken(newUser);
    res.cookie('jwt', token, { 
      httpOnly: true,
          secure: process.env.NODE_ENV === 'development',
          sameSite: 'strict',
          maxAge: 7 * 24 * 60 * 60 * 1000, 
          path: '/'
    });
    newUser.lastLogin = new Date();
    await newUser.save();
    const userResponse = prepareUserData(newUser);

    sendResponse(res, 201, true, 'Account created and logged in!', { user: userResponse});
  } catch (error) {
    sendResponse(res, 500, false, 'Internal server error.', null, error);
    return
  }
};



export const loginUser= async(req: Request, res: Response): Promise<void> =>{
    const {email, password} = req.body
    if (!email || !password){
        sendResponse(res, 400, false, 'Missing fields');
        return
    }

    try{
        const user= await UserAccount.findOne({email})
        if(!user){
            sendResponse(res, 401, false, 'Invalid email or password');
            return
        }
        const isPasswordValid= await bcrypt.compare(password, user.password)
        if (!isPasswordValid){
            sendResponse(res, 401, false, 'Invalid email or password');
            return
        }

        const token= generateToken(user)
        const lastLogin= new Date()
        user.lastLogin= lastLogin
        await user.save()
        const response= prepareUserData(user)
        res.cookie('jwt', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'development',
          sameSite: 'strict',
          maxAge: 7 * 24 * 60 * 60 * 1000, 
          path: '/'
        });
        sendResponse(res, 200, true, 'Login successful', { user: response });
    }catch (error){
        sendResponse(res, 500, false, 'Internal server error');
        return
    }
}

export const getCurrentUser= async (req:Request, res: Response):Promise<void> =>{
    const userId= (req as any).user?._id
    if (!userId) {
       sendResponse(res, 401, false, 'Unauthorized.');
    }

    try{
        const user = await UserAccount.findById(userId).select('-password')
        if (!user) {
        sendResponse(res, 404, false, 'User not found.');
        return;
        }

        sendResponse(res, 200, true, 'User fetched successfully.', user);
    }catch(error){
        sendResponse(res, 500, false, 'Server error fetching user.', null, error);
        return;
    }
    
}

export const signout = async (req: Request, res: Response): Promise<void> => {
  try {

    res.clearCookie('jwt', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'development', 
      sameSite: 'strict',
      path: '/',
    });

    sendResponse(res, 200, true, 'Logged out successfully');
  } catch (error) {
    sendResponse(res, 500, false, 'Logout failed', null, error);
  }
};

