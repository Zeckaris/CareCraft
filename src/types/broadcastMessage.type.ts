import { Document, Types } from 'mongoose';

export type BroadcastPriority = 'urgent' | 'normal' | 'low';

export interface IBroadcastMessage extends Document {
  _id: Types.ObjectId;
  title: string;                                      
  body: string;                                       
  recipients: ('Admin' | 'Coordinator' | 'Teacher' | 'Parent' | 'All')[];  
  sentBy: Types.ObjectId;                            
  sentAt?: Date | null;                              
  status: 'draft' | 'sent';                          
  priority: BroadcastPriority;                        
  queueJobId?: string;                                
  createdAt: Date;
  updatedAt: Date;
}
