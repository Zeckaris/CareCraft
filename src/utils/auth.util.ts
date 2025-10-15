import jwt from 'jsonwebtoken'
import { IUserAccount } from '../types/userAccount.type'

const secretKey= process.env.JWT_SECRET_KEY as string 
const tokenExpirationTime = parseInt(process.env.JWT_TOKEN_EXPIRES_IN || '604800', 10)


export const generateToken = (user: IUserAccount) =>{
    const payload= {
        id: user._id,
        email: user.email,
        role: user.role
    }
    
    const token= jwt.sign(payload, secretKey, {expiresIn: tokenExpirationTime})
}

export const verifyToken= (token: string):any =>{
    try{
        return jwt.verify(token, secretKey)
    }catch(erro){
        throw new Error('Invalid token')
    }
}


export const stripPassword = (user: IUserAccount | any): any => {
    const userWithoutPassword = {...user}
    delete userWithoutPassword.password
    return userWithoutPassword
}