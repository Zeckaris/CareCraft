import { Request, Response } from 'express';
import UserAccount from '../../models/userAccount.model'
import { Student } from '../../models/student.model';
import { InviteToken } from '../../models/inviteToken.model';
import bcrypt from 'bcrypt'
import { generateToken, prepareUserData } from '../../utils/auth.util';
import mongoose from 'mongoose';
import { validateEmail, sendInviteEmail, validateVerificationCode, verificationCodes, transporter } from '../../utils/emailVerification.util'
import crypto from 'crypto';


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
  if (!email) return res.status(400).json({ message: 'Email required.' });

  if (!validateEmail(email)) {
    return res.status(400).json({ message: 'Invalid email format.' });
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
    res.status(200).json({ message: 'Verification code sent! Check your inbox.' });
  } catch (error) {
    verificationCodes.delete(email);
    res.status(500).json({ message: 'Failed to send verification email.' });
  }
};


export const signupUser = async (req: Request, res: Response): Promise<void> => {
  const { firstName, lastName, email, password, role, phoneNumber, inviteToken, verificationCode} =
    req.body as SignupRequestBody;

  if (!firstName || !lastName || !email || !password || !role || !phoneNumber) {
    res.status(400).json({ message: 'Missing required fields.' });
    return;
  }

  try {
    const existingUser = await UserAccount.findOne({ email });
    if (existingUser) {
      res.status(400).json({ message: 'User already exists.' });
      return;
    }
    const codeValidation = validateVerificationCode(email, verificationCode);
    if (!codeValidation.success) {
      res.status(400).json({ message: codeValidation.message });
      return;
    }

    let studentToAssociate = null;

    if (role === 'parent' || role === 'teacher') {
      if (!inviteToken) {
        res.status(400).json({ message: 'Invite token is required for this role.' });
        return;
      }

      const tokenRecord = await InviteToken.findOne({ token: inviteToken });
      if (!tokenRecord) {
        res.status(400).json({ message: 'Invalid invite token.' });
        return;
      }
      if (tokenRecord.role !== role) {
        res.status(400).json({ message: 'Invite token role mismatch.' });
        return;
      }
      if (tokenRecord.isUsed || tokenRecord.expiresAt < new Date()) {
        res.status(400).json({ message: 'Invite token is expired or already used.' });
        return;
      }

      if (role === 'parent') {
        if (!tokenRecord.createdFor) {
          res.status(400).json({ message: 'No student associated with this invite token.' });
          return;
        }
        studentToAssociate = await Student.findById(tokenRecord.createdFor);
        if (!studentToAssociate) {
          res.status(404).json({ message: 'Associated student not found.' });
          return;
        }
      }

      console.log("tokenrecord is being modified");
      tokenRecord.isUsed = true;
      await tokenRecord.save();
    }

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

    res.status(201).json({ message: 'User created successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error.', error });
  }
};



export const loginUser= async(req: Request, res: Response): Promise<void> =>{
    const {email, password} = req.body
    if (!email || !password){
        res.status(400).json({message: "Missing fields"})
        return
    }

    try{
        const user= await UserAccount.findOne({email})
        if(!user){
            res.status(401).json({message: "Invalid email or password"})
            return
        }
        const isPasswordValid= await bcrypt.compare(password, user.password)
        if (!isPasswordValid){
            res.status(401).json({message: "Invalid email or password"})
            return
        }

        const token= generateToken(user)
        const lastLogin= new Date()
        user.lastLogin= lastLogin
        await user.save()
        const response= prepareUserData(user)
        
        res.status(200).json({message: "Login successful", token, response})
    }catch (error){
        res.status(500).json({message: "Internal server error"})
    }
}

export const getCurrentUser= async (req:Request, res: Response):Promise<void> =>{
    const userId= (req as any).user?._id
    if (!userId) {
       res.status(401).json({ message: 'Unauthorized.'})
    }

    try{
        const user = await UserAccount.findById(userId).select('-password')
        if (!user) {
        res.status(404).json({ message: 'User not found.' })
        return;
        }

        res.status(200).json({ user })
    }catch(error){
        res.status(500).json({ message: 'Server error fetching user.', error })
    }
    
}

