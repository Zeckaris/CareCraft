import jwt from 'jsonwebtoken'
import { IUserAccount } from '../types/userAccount.type.ts'
import { profile } from 'console'
import { Types } from 'mongoose'

const secretKey= process.env.JWT_SECRET_KEY as string 
const tokenExpirationTime = parseInt(process.env.JWT_TOKEN_EXPIRES_IN || '604800', 10)
interface JWTPayload {
  id: string | Types.ObjectId;
  email: string;
  role: string;
  firstName: string;
  iat?: number;
  exp?: number;
}

export const generateToken = (user: IUserAccount) =>{
    const payload= {
        id: user._id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
    }
    const token= jwt.sign(payload, secretKey, {expiresIn: tokenExpirationTime})
    return token
}

export const verifyToken= (token: string):JWTPayload =>{
    try{
        return jwt.verify(token, secretKey)as JWTPayload;
    }catch(erro){
        throw new Error('Invalid token')
    }
}


export const prepareUserData = (user: any) => {
  const { _id, email, role, firstName } = user.toObject ? user.toObject() : user
  return { _id, email, role, firstName }
}