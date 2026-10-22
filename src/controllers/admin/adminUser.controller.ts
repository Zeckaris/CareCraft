import { Request, Response } from 'express';
import UserAccount from '../../models/userAccount.model.js';
import { TeachingAssignment } from '../../models/teachingAssignment.model.js';
import { AttributeEvaluation } from '../../models/attributeEvaluation.model.js';
import { Observation } from '../../models/observation.model.js';
import { ScheduleEntry } from '../../models/scheduleEntry.model.js';
import { ActionPlan } from '../../models/actionPlan.model.js';
import { Report } from '../../models/report.model.js';
import { ChatRoom } from '../../models/chatRoom.model.js';
import { FlaggedIssue } from '../../models/flaggedIssue.model.js';
import { Notification } from '../../models/notification.model.js';
import { Student } from '../../models/student.model.js';
import { guardDeleteReferences, ReferenceCheck } from '../../utils/referenceGuard.util.js';
import { sendResponse } from '../../utils/sendResponse.util.js';
import { IUserAccount } from '../../types/userAccount.type.js';

interface AuthRequest extends Request {
  user?: { id: string; email: string; role: 'admin' | 'teacher' | 'parent' | 'student' | 'coordinator' };
}

export const getAllTeachers = async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    // Allow caller to override limit (max 200) or pass limit=0 to fetch all.
    const rawLimit = parseInt(req.query.limit as string);
    const fetchAll = rawLimit === 0;
    const limit = fetchAll ? 0 : Math.min(isNaN(rawLimit) ? 10 : rawLimit, 200);
    const skip = fetchAll ? 0 : (page - 1) * limit;

    // By default exclude suspended teachers (assignment-picker use-case).
    // Pass includeSuspended=true to see all.
    const includeSuspended = req.query.includeSuspended === 'true';
    const filter: Record<string, any> = { role: 'teacher' };
    if (!includeSuspended) filter.isSuspended = { $ne: true };

    const total = await UserAccount.countDocuments(filter);

    const query = UserAccount.find(filter)
      .select('firstName lastName email phoneNumber isSuspended lastLogin createdAt updatedAt')
      .sort({ createdAt: -1 });

    if (!fetchAll) query.skip(skip).limit(limit);

    const teachers = await query;

    sendResponse(res, 200, true, 'Teachers fetched successfully.', teachers, null, {
      total,
      page: fetchAll ? 1 : page,
      limit: fetchAll ? total : limit,
    });
  } catch (error) {
    sendResponse(res, 500, false, `Server error: ${(error as Error).message}`);
  }
};


export const getAllParents = async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1; // <-- default page = 1
    const limit = 10;
    const skip = (page - 1) * limit;
    const total = await UserAccount.countDocuments({ role: 'parent' });


    const parents = await UserAccount.find({ role: 'parent' }).select('firstName lastName email phoneNumber lastLogin createdAt updatedAt')
  .skip(skip)
  .limit(limit)
  .sort({ createdAt: -1 });

    sendResponse(res, 200, true, 'Parents fetched successfully.', parents, {
      total,
      page,
      limit,
    });

  } catch (error) {
    sendResponse(res, 500, false, `Server error: ${(error as Error).message}`);
  }
};


export const getAllCoordinators = async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const total = await UserAccount.countDocuments({ role: 'coordinator' });

    const coordinators = await UserAccount.find({ role: 'coordinator' })
      .select('firstName lastName email phoneNumber lastLogin createdAt updatedAt')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 }); 

    sendResponse(res, 200, true, 'Coordinators fetched successfully.', coordinators, {
      total,
      page,
      limit,
    });
  } catch (error) {
    sendResponse(res, 500, false, `Server error: ${(error as Error).message}`);
  }
};



export const updateUser = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, email, phoneNumber } = req.body;

    const updates: Partial<IUserAccount> = {};
    if (firstName) updates.firstName = firstName.trim();
    if (lastName) updates.lastName = lastName.trim();
    if (email) updates.email = email.toLowerCase().trim();
    if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber;

    if (Object.keys(updates).length === 0) {
      return sendResponse(res, 400, false, 'No valid fields provided.');
    }

    if (email) {
      const exists = await UserAccount.findOne({ email, _id: { $ne: id } });
      if (exists) return sendResponse(res, 400, false, 'Email already in use.');
    }

    const user = await UserAccount.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('firstName lastName email phoneNumber role');

    if (!user) return sendResponse(res, 404, false, 'User not found.');

    sendResponse(res, 200, true, 'User updated successfully.', user);
  } catch (error: any) {
    if (error.code === 11000) {
      return sendResponse(res, 400, false, 'Email already exists.');
    }
    sendResponse(res, 500, false, `Server error: ${error.message}`);
  }
};



export const deleteUser = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const requester = req.user; 

    if (!requester) {
      return sendResponse(res, 500, false, 'Requester data missing.');
    }

    const userToDelete = await UserAccount.findById(id);
    if (!userToDelete) {
      return sendResponse(res, 404, false, 'User not found.');
    }

    // === PREVENT SELF-DELETE ===
    if (requester.id === id) {
      return sendResponse(res, 400, false, 'You cannot delete your own account.');
    }

    const role = userToDelete.role;

    // === PROTECT LAST COORDINATOR ===
    if (role === 'coordinator') {
      const coordCount = await UserAccount.countDocuments({ role: 'coordinator' });
      if (coordCount <= 1) {
        return sendResponse(res, 400, false, 'Cannot delete the last coordinator.');
      }
    }

    // === ADMIN DELETION: "First Admin" Rule ===
    if (role === 'admin') {
      const requesterFull = await UserAccount.findById(requester.id);
      if (!requesterFull) {
        return sendResponse(res, 500, false, 'Requester account not found.');
      }

      // 2. Only allow if requester was created BEFORE the target
      if (requesterFull.createdAt >= userToDelete.createdAt) {
        return sendResponse(
          res,
          403,
          false,
          'You cannot delete an admin who was created before you.'
        );
      }

      const firstAdmin = await UserAccount.findOne({ role: 'admin' }).sort({ createdAt: 1 });
      if (firstAdmin?._id.toString() === id) {
        return sendResponse(res, 403, false, 'Cannot delete the original admin.');
      }
    }

    // === BLOCK DELETION WHILE ACADEMIC OR HISTORICAL RECORDS REFERENCE THE USER ===
    const referenceChecks: ReferenceCheck[] = [];

    if (role === 'teacher') {
      referenceChecks.push(
        { model: TeachingAssignment, field: 'teacherId', label: 'teaching assignment(s)' },
        {
          model: ScheduleEntry,
          field: 'teacherId',
          label: 'schedule entry(ies)',
          excludeArchivedSchedules: true,
        },
        { model: ActionPlan, field: 'teacherId', label: 'action plan(s)' },
        { model: Report, field: 'teacherId', label: 'report(s)' },
        { model: ChatRoom, field: 'teacherId', label: 'chat room(s)' },
        { model: FlaggedIssue, field: 'teacherId', label: 'flagged issue(s)' },
        { model: AttributeEvaluation, field: 'teacherId', label: 'attribute evaluation(s)' },
        { model: Observation, field: 'teacherId', label: 'observation(s)' }
      );
    } else if (role === 'parent') {
      referenceChecks.push(
        { model: Student, field: 'parentId', label: 'linked student(s)' },
        { model: ChatRoom, field: 'parentId', label: 'chat room(s)' }
      );
    }

    if (await guardDeleteReferences(res, role, id, referenceChecks, { person: true })) {
      return;
    }

    // === SAFE TO DELETE ===
    await Notification.deleteMany({ userId: id });
    await UserAccount.findByIdAndDelete(id);
    sendResponse(res, 200, true, 'User deleted successfully.');

  } catch (error) {
    sendResponse(res, 500, false, `Server error: ${(error as Error).message}`);
  }
};