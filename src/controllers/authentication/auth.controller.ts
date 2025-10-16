import { Request, Response } from 'express';
import UserAccount from '../../models/userAccount.model'
import bcrypt from 'bcrypt'
import { generateToken, prepareUserData } from '../../utils/auth.util';

export const signupUser= async (req:Request, res:Response):Promise<void> =>{
    const {firstName,
        lastName,
        email,
        password,
        role,
        phoneNumber} = req.body

    if( !firstName || !lastName || !email || !password || !role  || !phoneNumber){
        res.status(400).json({message : "Missing fields"})
        return
    }
    
    try{
        const user = await UserAccount.findOne({email})
        if(user){
            res.status(400).json({message : "User already exists"})
            return
        }
        const hashedPassword= bcrypt.hashSync(password, 10)
        const newUser=  new UserAccount({
            firstName, 
            lastName,
            email,
            password: hashedPassword,
            role,
            phoneNumber
        })
        await newUser.save()
        console.log('signup activated')
        res.status(201).json({message: "User created successfully"})
    }catch (error){
        res.status(500).json({message: "Internal server error"})
    }

}



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
        const isPasswordValid= bcrypt.compare(password, user.password)
        if (!isPasswordValid){
            res.status(401).json({message: "Invalid email or password"})
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