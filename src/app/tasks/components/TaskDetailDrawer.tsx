'use client';

import { Task } from '../data/mock';
import { X, Clock, User, Link as LinkIcon, Paperclip, Activity, CheckSquare, Edit2, PlayCircle, Plus, Copy, Trash2, Save } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { updateTaskStatus, addChecklistItem, toggleChecklistItem, addTaskComment, cloneTask, deleteTask, updateTaskDetails } from '../actions';

interface TaskDetailDrawerProps {
  task: Task | null;
  onClose: () => void;
}

const statusColors: Record<string, string> = {
  'Not Started': 'bg-gray-400/10 text-gray-400',
  'Assigned': 'bg-blue-400/10 text-blue-400',
  'Accepted': 'bg-indigo-400/10 text-indigo-400',
  'In Progress': 'bg-cyan-400/10 text-cyan-400',
  'Blocked': 'bg-red-400/10 text-red-400',
  'On Hold': 'bg-amber-400/10 text-amber-400',
  'Completed': 'bg-green-400/10 text-green-400',
  'Verified': 'bg-emerald-400/10 text-emerald-400',
  'Closed': 'bg-teal-400/10 text-teal-400',
  'Cancelled': 'bg-red-400/10 text-red-400',
};

const priorityColors: Record<string, string> = {
  'LOW': 'text-gray-400 border-gray-400/20',
  'MEDIUM': 'text-yellow-400 border-yellow-400/20',
  'HIGH': 'text-orange-400 border-orange-400/20',
  'CRITICAL': 'text-red-400 border-red-400/20',
};

export default function TaskDetailDrawer({ task, onClose }: TaskDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState('Details');
  const [updating, setUpdating] = useState(false);
  
  const [commentText, setCommentText] = useState('');
  const [checklistItemText, setChecklistItemText] = useState('');

  // Inline editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task?.name || '');
  const [editDescription, setEditDescription] = useState(task?.description || '');

  if (!task) return null;

  const handleClone = async () => {
    if (!confirm('Are you sure you want to clone this task?')) return;
    setUpdating(true);
    const res = await cloneTask(task.id);
    setUpdating(false);
    if (res.success) {
      alert('Task cloned successfully!');
      window.location.reload();
    } else {
      alert(res.error || 'Failed to clone task');
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this task? This action cannot be undone.')) return;
    setUpdating(true);
    const res = await deleteTask(task.id);
    setUpdating(false);
    if (res.success) {
      onClose();
      window.location.reload();
    } else {
      alert(res.error || 'Failed to delete task');
    }
  };

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) return;
    setUpdating(true);
    const formData = new FormData();
    formData.append('title', editTitle);
    formData.append('description', editDescription);
    const res = await updateTaskDetails(task.id, formData);
    setUpdating(false);
    if (res.success) {
      setIsEditing(false);
      window.location.reload();
    } else {
      alert(res.error || 'Failed to update task');
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    setUpdating(true);
    const res = await updateTaskStatus(task.id, newStatus);
    setUpdating(false);
    if (res.success) {
      window.location.reload();
    } else {
      alert(res.error || 'Failed to update task status');
    }
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    setUpdating(true);
    const res = await addTaskComment(task.id, commentText);
    setUpdating(false);
    if (res.success) {
      setCommentText('');
      window.location.reload();
    } else {
      alert(res.error || 'Failed to add comment');
    }
  };

  const handleAddChecklist = async () => {
    if (!checklistItemText.trim()) return;
    setUpdating(true);
    const res = await addChecklistItem(task.id, checklistItemText);
    setUpdating(false);
    if (res.success) {
      setChecklistItemText('');
      window.location.reload();
    } else {
      alert(res.error || 'Failed to add item');
    }
  };

  const handleToggleChecklist = async (itemId: string, currentStatus: boolean) => {
    setUpdating(true);
    const res = await toggleChecklistItem(itemId, task.id, !currentStatus);
    setUpdating(false);
    if (res.success) {
      window.location.reload();
    } else {
      alert(res.error || 'Failed to toggle item');
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] transition-opacity"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full md:w-[800px] bg-[#0D0D0F] border-l border-[#292B30] z-[101] shadow-2xl flex flex-col transform transition-transform">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#292B30] bg-[#111113] flex items-start justify-between shrink-0">
          <div>
            <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
              TASK DETAILS 
              <span className="text-yellow-400 font-mono">• {task.id}</span>
            </div>
            {isEditing ? (
              <input 
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full bg-[#151619] border border-[#292B30] rounded-lg px-3 py-2 text-[20px] font-black text-white focus:outline-none focus:border-yellow-400/50 mb-3"
              />
            ) : (
              <h2 className="text-[22px] font-black text-white leading-tight mb-3">{task.name}</h2>
            )}
            
            <div className="flex items-center gap-3">
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-md uppercase tracking-wider ${statusColors[task.status]}`}>
                {task.status}
              </span>
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-md uppercase tracking-wider border ${priorityColors[task.priority]} bg-[#151619]`}>
                Priority: {task.priority}
              </span>
            </div>
          </div>
          
          <button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-[#151619] border border-[#292B30] hover:text-white text-gray-500 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Bar */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-[#292B30] bg-[#151619] shrink-0 overflow-x-auto no-scrollbar">
          <button
            disabled={updating || task.status === 'Completed'}
            onClick={() => handleStatusChange('Completed')}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500 hover:bg-green-400 text-black text-[11px] font-bold transition-colors shadow-[0_0_10px_rgba(34,197,94,0.2)] disabled:opacity-50"
          >
            <CheckSquare className="w-3.5 h-3.5" /> Complete Task
          </button>
          <button
            disabled={updating || task.status === 'In Progress'}
            onClick={() => handleStatusChange('In Progress')}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#0D0D0F] border border-[#292B30] hover:border-gray-500 text-gray-300 text-[11px] font-bold transition-colors disabled:opacity-50"
          >
            <PlayCircle className="w-3.5 h-3.5" /> Start Task
          </button>
          <div className="w-px h-4 bg-[#292B30] mx-1" />
          <button
            disabled={updating || task.status === 'Blocked'}
            onClick={() => handleStatusChange('Blocked')}
            className="px-3 py-1.5 rounded-lg hover:bg-[#1a1b1f] text-red-400 hover:text-red-300 text-[11px] font-semibold transition-colors disabled:opacity-50"
          >
            Mark Blocked
          </button>
          
          <div className="flex-1" />
          
          <button
            disabled={updating}
            onClick={handleClone}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0D0D0F] border border-[#292B30] hover:border-gray-500 text-gray-300 text-[11px] font-bold transition-colors disabled:opacity-50"
          >
            <Copy className="w-3.5 h-3.5" /> Clone
          </button>
          
          <button
            disabled={updating}
            onClick={handleDelete}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0D0D0F] border border-red-500/30 hover:border-red-500 text-red-400 text-[11px] font-bold transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>


        {/* Internal Tabs */}
        <div className="flex items-center gap-6 px-6 border-b border-[#292B30] shrink-0">
          {['Details', 'Checklist', 'Comments', 'Attachments', 'Activity'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3 text-[12px] font-bold tracking-wider relative transition-colors ${
                activeTab === tab ? 'text-yellow-400' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab}
              {activeTab === tab && (
                <div className="absolute bottom-0 left-0 w-full h-0.5 bg-yellow-400 rounded-t-full" />
              )}
            </button>
          ))}
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          
          {activeTab === 'Details' && (
            <>
              {/* Linked Records */}
              <div className="bg-[#151619] border border-[#292B30] rounded-xl p-5">
                <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <LinkIcon className="w-3.5 h-3.5" /> Related Information
                </h3>
                
                <div className="grid grid-cols-2 gap-4">
                  {task.projectName && (
                    <div className="flex flex-col">
                      <span className="text-[10px] text-gray-500 font-semibold uppercase mb-1">Project</span>
                      <Link href={`/projects/${task.projectId}`} className="text-[12px] font-bold text-blue-400 hover:underline">
                        {task.projectName}
                      </Link>
                    </div>
                  )}
                  {task.customerName && (
                    <div className="flex flex-col">
                      <span className="text-[10px] text-gray-500 font-semibold uppercase mb-1">Customer</span>
                      <Link href="/customers" className="text-[12px] font-bold text-blue-400 hover:underline">
                        {task.customerName}
                      </Link>
                    </div>
                  )}
                  {task.source && (
                    <div className="flex flex-col">
                      <span className="text-[10px] text-gray-500 font-semibold uppercase mb-1">Source</span>
                      <span className="text-[12px] font-bold text-white">{task.source}</span>
                    </div>
                  )}
                  <div className="flex flex-col">
                    <span className="text-[10px] text-gray-500 font-semibold uppercase mb-1">Task Type</span>
                    <span className="text-[12px] font-bold text-white">{task.type}</span>
                  </div>
                </div>

                {/* Tags & Flags */}
                {(task.requiresCompletionProof || task.requiresVerification || task.isRecurringInstance) && (
                  <div className="mt-4 pt-4 border-t border-[#292B30] flex flex-wrap gap-2">
                    {task.isRecurringInstance && (
                      <span className="text-[10px] bg-yellow-400/10 text-yellow-400 px-2 py-1 rounded font-bold uppercase">
                        Recurring Instance
                      </span>
                    )}
                    {task.requiresCompletionProof && (
                      <span className="text-[10px] bg-blue-400/10 text-blue-400 px-2 py-1 rounded font-bold uppercase">
                        Proof Required
                      </span>
                    )}
                    {task.requiresVerification && (
                      <span className="text-[10px] bg-purple-400/10 text-purple-400 px-2 py-1 rounded font-bold uppercase">
                        Verification Required
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Description */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Description</h3>
                  {!isEditing ? (
                    <button 
                      onClick={() => setIsEditing(true)}
                      className="text-[10px] font-bold text-gray-500 hover:text-yellow-400 flex items-center gap-1 transition-colors"
                    >
                      <Edit2 className="w-3 h-3" /> Edit
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => {
                          setIsEditing(false);
                          setEditTitle(task.name);
                          setEditDescription(task.description || '');
                        }}
                        className="text-[10px] font-bold text-gray-400 hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={handleSaveEdit}
                        disabled={updating}
                        className="text-[10px] font-bold text-black bg-yellow-400 hover:bg-yellow-300 px-2 py-1 rounded flex items-center gap-1 transition-colors disabled:opacity-50"
                      >
                        <Save className="w-3 h-3" /> Save
                      </button>
                    </div>
                  )}
                </div>
                
                {isEditing ? (
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={4}
                    className="w-full text-[13px] text-white leading-relaxed bg-[#151619] border border-[#292B30] rounded-xl p-4 focus:outline-none focus:border-yellow-400/50 resize-none"
                    placeholder="Task description..."
                  />
                ) : (
                  <p className="text-[13px] text-gray-300 leading-relaxed bg-[#151619] border border-[#292B30] rounded-xl p-4 whitespace-pre-wrap">
                    {task.description}
                  </p>
                )}
              </div>

              {/* Assignments & Dates Grid */}
              <div className="grid grid-cols-2 gap-6">
                
                {/* Assignments */}
                <div className="bg-[#151619] border border-[#292B30] rounded-xl p-5">
                  <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <User className="w-3.5 h-3.5" /> Assignment
                  </h3>
                  <div className="space-y-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-gray-500 font-semibold uppercase">Assigned To</span>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-yellow-400/20 text-yellow-400 flex items-center justify-center text-[10px] font-bold">
                          {task.assignedTo.charAt(0)}
                        </div>
                        <span className="text-[13px] font-bold text-white">{task.assignedTo}</span>
                      </div>
                    </div>
                    
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-gray-500 font-semibold uppercase">Assigned By</span>
                      <span className="text-[12px] font-semibold text-gray-400">{task.assignedBy}</span>
                    </div>

                    {task.collaborators && task.collaborators.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] text-gray-500 font-semibold uppercase">Secondary / Collaborators</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {task.collaborators.map((c: string) => (
                            <span key={c} className="text-[11px] font-medium bg-[#292B30] text-gray-300 px-2 py-0.5 rounded">
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Dates & Progress */}
                <div className="bg-[#151619] border border-[#292B30] rounded-xl p-5">
                  <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5" /> Schedule & Progress
                  </h3>
                  
                  <div className="space-y-4">
                    {/* Progress */}
                    <div className="flex flex-col gap-2 border-b border-[#292B30] pb-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-500 font-semibold uppercase">Task Progress</span>
                        <span className="text-[12px] font-bold text-yellow-400">{task.progress}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-[#0D0D0F] rounded-full overflow-hidden border border-[#292B30]">
                        <div 
                          className="h-full bg-yellow-400 rounded-full transition-all"
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-gray-500 font-semibold uppercase mb-1">Created</span>
                        <span className="text-[12px] font-semibold text-white">
                          {new Date(task.createdDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] text-gray-500 font-semibold uppercase mb-1">Due Date</span>
                        <span className="text-[12px] font-bold text-amber-400">
                          {new Date(task.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      
                      {task.estimatedHours && (
                        <div className="flex flex-col">
                          <span className="text-[10px] text-gray-500 font-semibold uppercase mb-1">Estimated</span>
                          <span className="text-[12px] font-semibold text-white">{task.estimatedHours} hrs</span>
                        </div>
                      )}
                      
                      {task.actualHours && (
                        <div className="flex flex-col">
                          <span className="text-[10px] text-gray-500 font-semibold uppercase mb-1">Actual</span>
                          <span className="text-[12px] font-semibold text-white">{task.actualHours} hrs</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              </div>

              {/* Dependencies */}
              {(task.blockedBy?.length || task.blocks?.length) && (
                <div className="bg-[#151619] border border-[#292B30] rounded-xl p-5">
                  <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                    Dependencies
                  </h3>
                  
                  {task.blockedBy && task.blockedBy.length > 0 && (
                    <div className="mb-3">
                      <span className="text-[10px] text-red-400 font-bold uppercase tracking-wider mb-2 block">Blocked By:</span>
                      {task.blockedBy.map(id => (
                        <div key={id} className="text-[12px] font-medium text-gray-300 p-2 bg-[#0D0D0F] border border-[#292B30] rounded-lg">
                          {id}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {activeTab === 'Checklist' && (
            <div className="bg-[#151619] border border-[#292B30] rounded-xl p-5">
               <div className="flex items-center justify-between mb-6">
                <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <CheckSquare className="w-3.5 h-3.5" /> Checklist
                </h3>
                <span className="text-[11px] font-bold text-gray-400">
                  {task.checklist.filter(c => c.completed).length} / {task.checklist.length} Completed
                </span>
              </div>
              <div className="space-y-3">
                {task.checklist.map(item => (
                  <div key={item.id} className="flex items-center gap-3">
                    <button 
                      onClick={() => handleToggleChecklist(item.id, item.completed)}
                      disabled={updating}
                      className={`w-5 h-5 rounded flex items-center justify-center border transition-colors ${
                      item.completed ? 'bg-green-500 border-green-500 text-black' : 'bg-[#0D0D0F] border-gray-600 text-transparent hover:border-gray-400'
                    }`}>
                      <CheckSquare className="w-3.5 h-3.5" />
                    </button>
                    <span className={`text-[13px] font-medium ${item.completed ? 'text-gray-500 line-through' : 'text-gray-200'}`}>
                      {item.title}
                    </span>
                  </div>
                ))}
                
                <div className="mt-4 flex gap-2">
                  <input 
                    type="text" 
                    value={checklistItemText}
                    onChange={(e) => setChecklistItemText(e.target.value)}
                    placeholder="New checklist item..." 
                    className="flex-1 bg-[#0D0D0F] border border-[#292B30] rounded-lg px-3 py-2 text-[12px] text-white focus:outline-none focus:border-yellow-400/50"
                  />
                  <button 
                    onClick={handleAddChecklist}
                    disabled={updating || !checklistItemText.trim()}
                    className="flex items-center gap-2 text-[12px] font-bold bg-yellow-400/10 text-yellow-400 px-3 py-2 rounded-lg hover:bg-yellow-400/20 disabled:opacity-50">
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Comments' && (
            <div className="space-y-6">
              {/* Comment Input */}
              <div className="bg-[#151619] border border-[#292B30] rounded-xl p-4">
                <textarea 
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  className="w-full bg-[#0D0D0F] border border-[#292B30] rounded-lg p-3 text-[13px] text-white placeholder-gray-600 focus:outline-none focus:border-yellow-400/50 min-h-[100px] resize-none mb-3"
                  placeholder="Write a comment..."
                />
                <div className="flex items-center justify-between">
                  <button className="text-gray-500 hover:text-white transition-colors p-2 rounded hover:bg-[#292B30]">
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={handleAddComment}
                    disabled={updating || !commentText.trim()}
                    className="px-4 py-2 bg-yellow-400 hover:bg-yellow-300 text-black text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50">
                    Comment
                  </button>
                </div>
              </div>

              {/* Comment List */}
              <div className="space-y-4">
                {task.comments && task.comments.map((comment: any) => (
                  <div key={comment.id} className="flex gap-4 bg-[#151619] border border-[#292B30] rounded-xl p-4">
                    <div className="w-8 h-8 rounded-full bg-yellow-400/20 text-yellow-400 flex items-center justify-center text-[12px] font-bold shrink-0">
                      {comment.user ? comment.user.charAt(0) : 'U'}
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-[13px] font-bold text-white">{comment.user}</span>
                        <span className="text-[10px] text-gray-500">
                          {comment.timestamp}
                        </span>
                      </div>
                      <p className="text-[13px] text-gray-300 leading-relaxed">
                        {comment.text}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'Activity' && (
            <div className="bg-[#151619] border border-[#292B30] rounded-xl p-6">
              <div className="space-y-6">
                {task.activities && task.activities.map((activity: any, idx: number) => (
                  <div key={activity.id} className="flex gap-4 relative">
                    {idx !== task.activities.length - 1 && (
                      <div className="absolute top-8 bottom-[-24px] left-3.5 w-px bg-[#292B30]" />
                    )}
                    <div className="w-7 h-7 rounded-full bg-[#0D0D0F] border border-[#292B30] flex items-center justify-center shrink-0 z-10">
                      <Activity className="w-3 h-3 text-gray-500" />
                    </div>
                    <div className="flex flex-col pt-1">
                      <div className="text-[13px] text-gray-300">
                        <span className="font-bold text-white">{activity.user}</span> {activity.action}
                      </div>
                      <div className="text-[10px] text-gray-500 font-mono mt-1">
                        {activity.date}
                      </div>
                      {activity.details && activity.details !== "To " && (
                        <div className="text-[11px] text-gray-400 mt-1 italic">{activity.details}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'Attachments' && (
            <div className="bg-[#151619] border border-[#292B30] rounded-xl p-5">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                  <Paperclip className="w-3.5 h-3.5" /> Attached Files
                </h3>
                <button className="text-[11px] font-bold text-yellow-400 hover:text-yellow-300 transition-colors">
                  + Upload File
                </button>
              </div>

              <div className="space-y-2">
                {task.attachments.map(file => (
                  <div key={file.id} className="flex items-center justify-between p-3 bg-[#0D0D0F] border border-[#292B30] rounded-lg group hover:border-gray-500 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded bg-[#151619] border border-[#292B30] flex items-center justify-center text-[10px] font-bold text-gray-400">
                        {file.fileName.split('.').pop()?.toUpperCase()}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[12px] font-bold text-white group-hover:text-blue-400 transition-colors cursor-pointer">{file.fileName}</span>
                        <span className="text-[10px] text-gray-500">{file.fileSize}</span>
                      </div>
                    </div>
                    <button className="text-[11px] text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all font-semibold px-2">
                      Delete
                    </button>
                  </div>
                ))}
                {task.attachments.length === 0 && (
                  <div className="text-center py-8 text-gray-500 text-[12px]">
                    No files attached.
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
