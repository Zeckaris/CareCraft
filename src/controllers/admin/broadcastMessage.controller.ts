import { Response } from "express"
import { BroadcastMessage } from "../../models/broadcastMessage.model.ts"
import { sendResponse } from "../../utils/sendResponse.util.ts"
import { Types } from "mongoose"
import { AuthRequest } from "../../middlewares/auth.middleware.ts"


// --- Utility function to validate recipient roles ---
const allowedRoles = ['admin', 'coordinator', 'teacher', 'parent', 'all']
const validateRecipientRoles = (roles: string[]): boolean => {
    return roles.every(role => allowedRoles.includes(role))
}



// GET /broadcasts
export const getAllBroadcasts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, page = '1', limit = '20', all } = req.query as {
      status?: string;
      page?: string;
      limit?: string;
      all?: string;
    };

    const filter: any = {};
    if (status && ['draft', 'sent'].includes(status)) {
      filter.status = status;
    }

    let broadcasts;
    let total = 0;

    if (all === 'true') {
      // Fetch all broadcasts without pagination
      broadcasts = await BroadcastMessage.find(filter).sort({ createdAt: -1 });
      total = broadcasts.length;
      sendResponse(res, 200, true, "All broadcasts fetched successfully", broadcasts, null, {
        total,
        page: 1,
        limit: total
      });
    } else {
      // Paginated fetch
      const skip = (parseInt(page) - 1) * parseInt(limit);
      broadcasts = await BroadcastMessage.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      total = await BroadcastMessage.countDocuments(filter);

      sendResponse(res, 200, true, "Broadcasts fetched successfully", broadcasts, null, {
        total,
        page: parseInt(page),
        limit: parseInt(limit)
      });
    }
  } catch (error) {
    console.error("Get all broadcasts error:", error);
    sendResponse(res, 500, false, "Internal server error", null, error);
  }
};

// GET /broadcasts/:id
export const getBroadcastById = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id) {
    sendResponse(res, 400, false, "Missing broadcast ID");
    return;
  }

  try {
    const broadcast = await BroadcastMessage.findById(id);
    if (!broadcast) {
      sendResponse(res, 404, false, "Broadcast message not found");
      return;
    }

    sendResponse(res, 200, true, "Broadcast fetched successfully", broadcast);
  } catch (error) {
    console.error("Get broadcast by ID error:", error);
    sendResponse(res, 500, false, "Internal server error", null, error);
  }
};




// -------------------- Create Broadcast --------------------
export const createBroadcast = async (req: AuthRequest, res: Response): Promise<void> => {
    const { title, body, recipients, status } = req.body

    if (!title || !body || !recipients) {
        sendResponse(res, 400, false, "Missing required fields: title, body, or recipients")
        return
    }

    if (!Array.isArray(recipients) || !validateRecipientRoles(recipients)) {
        sendResponse(res, 400, false, "Invalid recipients array")
        return
    }

    try {
        const newBroadcast = new BroadcastMessage({
            title: title.trim(),
            body: body.trim(),
            recipients,
            status: status === 'sent' ? 'sent' : 'draft', // default to draft
            sentBy: req.user?.id // <-- use user from AuthRequest
        })

        await newBroadcast.save()
        sendResponse(res, 201, true, "Broadcast created successfully", newBroadcast)
    } catch (error) {
        console.error("Create broadcast error:", error)
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

// -------------------- Update Broadcast --------------------
export const updateBroadcast = async (req: AuthRequest, res: Response): Promise<void> => {
    const { id } = req.params
    const { title, body, recipients } = req.body

    if (!id || !Types.ObjectId.isValid(id)) {
        sendResponse(res, 400, false, "Invalid broadcast ID")
        return
    }

    try {
        const broadcast = await BroadcastMessage.findById(id)
        if (!broadcast) {
            sendResponse(res, 404, false, "Broadcast not found")
            return
        }

        if (broadcast.status !== 'draft') {
            sendResponse(res, 400, false, "Only draft broadcasts can be updated")
            return
        }

        if (recipients && (!Array.isArray(recipients) || !validateRecipientRoles(recipients))) {
            sendResponse(res, 400, false, "Invalid recipients array")
            return
        }

        if (title) broadcast.title = title.trim()
        if (body) broadcast.body = body.trim()
        if (recipients) broadcast.recipients = recipients

        await broadcast.save()
        sendResponse(res, 200, true, "Broadcast updated successfully", broadcast)
    } catch (error) {
        console.error("Update broadcast error:", error)
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

// -------------------- Delete Broadcast --------------------
export const deleteBroadcast = async (req: AuthRequest, res: Response): Promise<void> => {
    const { id } = req.params;

    if (!id || !Types.ObjectId.isValid(id)) {
        sendResponse(res, 400, false, "Invalid broadcast ID");
        return;
    }

    try {
        const broadcast = await BroadcastMessage.findById(id);
        if (!broadcast) {
            sendResponse(res, 404, false, "Broadcast not found");
            return;
        }

        if (broadcast.status !== 'draft') {
            sendResponse(res, 400, false, "Only draft broadcasts can be deleted");
            return;
        }

        await BroadcastMessage.findByIdAndDelete(id);
        sendResponse(res, 200, true, "Broadcast deleted successfully");
    } catch (error) {
        console.error("Delete broadcast error:", error);
        sendResponse(res, 500, false, "Internal server error", null, error);
    }
};

