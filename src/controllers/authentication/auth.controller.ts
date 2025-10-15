import { Request, Response } from 'express';
import UserAccount from '../../models/userAccount.model'
import bcrypt from 'bcrypt'

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
        res.status(201).json({message: "User created successfully"})
    }catch (error){
        res.status(500).json({message: "Internal server error"})
    }

}