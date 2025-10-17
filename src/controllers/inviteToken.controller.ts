import { Request, Response } from 'express';
import { InviteToken } from '../models/inviteToken.model';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'defaultsecret';


const isAdminOrCoordinator = (req: Request): boolean => {
    const userRole = (req as any).user?.role;
    return userRole === 'admin' || userRole === 'coordinator';
};




export const createInviteToken = async (req: Request, res: Response) => {
    if (!isAdminOrCoordinator(req)) {
        res.status(403).json({ message: 'Forbidden. Only admin or coordinator can create tokens.' });
        return;
    }

    const { role, studentId } = req.body;
    const expiresInMs = 180000;

    if (!role  || (role === 'parent' && !studentId)) {
        res.status(400).json({ message: 'Missing required fields.' });
        return;
    }

    try {
        const payload: any = { role: role.toLowerCase() };
        if (role === 'parent') payload.studentId = studentId;

        const token = jwt.sign(payload, JWT_SECRET, {
            expiresIn: expiresInMs / 1000,
        });

        const newToken = new InviteToken({
            token,
            role,
            createdFor: role === 'parent' ? studentId : null,
            expiresAt: new Date(Date.now() + expiresInMs),
        });

        await newToken.save();

        res.status(201).json({ message: 'Invite token created successfully.', token: newToken });
    } catch (error) {
        res.status(500).json({ message: 'Server error creating invite token.', error });
    }
};


export const getInviteTokens = async (req: Request, res: Response) => {
    if (!isAdminOrCoordinator(req)) {
        res.status(403).json({ message: 'Forbidden. Only admin or coordinator can view tokens.' });
        return;
    }

    try {
        const tokens = await InviteToken.find().sort({ createdAt: -1 });
        res.status(200).json({ tokens });
    } catch (error) {
        res.status(500).json({ message: 'Server error fetching invite tokens.', error });
    }
};


export const deleteInviteToken = async (req: Request, res: Response) => {
    if (!isAdminOrCoordinator(req)) {
        res.status(403).json({ message: 'Forbidden. Only admin or coordinator can delete tokens.' });
        return;
    }

    const { id } = req.params;

    try {
        const token = await InviteToken.findByIdAndDelete(id);
        if (!token) {
            res.status(404).json({ message: 'Invite token not found.' });
            return;
        }
        res.status(200).json({ message: 'Invite token deleted successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error deleting invite token.', error });
    }
};
