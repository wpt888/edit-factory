"use client";

import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, Film, ExternalLink, Loader2 } from "lucide-react";
import { apiDelete } from "@/lib/api";
import { toast } from "sonner";
import type { PostizPost, ScheduleItem } from "./PostizMonthlyCalendar";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

interface PostDetailModalProps {
  post: PostizPost | null;
  scheduleItem?: ScheduleItem;
  onClose: () => void;
  onDeleted: (postId: string) => void;
}

function stateColor(state: string): string {
  switch (state) {
    case "PUBLISHED": return "bg-green-500/20 text-green-300 border-green-500/30";
    case "QUEUE": return "bg-blue-500/20 text-blue-300 border-blue-500/30";
    case "ERROR": return "bg-red-500/20 text-red-300 border-red-500/30";
    case "DRAFT": return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    default: return "bg-gray-500/20 text-gray-400 border-gray-500/30";
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString("en-US", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return dateStr;
  }
}

export function PostDetailModal({ post, scheduleItem, onClose, onDeleted }: PostDetailModalProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  if (!post) return null;

  const content = stripHtml(post.content || "");

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await apiDelete(`/postiz/posts/${post.id}`);
      toast.success("Post deleted successfully");
      onDeleted(post.id);
      setShowDeleteConfirm(false);
      onClose();
    } catch (err) {
      console.error("Failed to delete post:", err);
      toast.error("Failed to delete post");
      setIsDeleting(false);
    }
  };

  const videoSrc = scheduleItem?.final_video_path
    ? `${API_URL}/library/files/${encodeURIComponent(scheduleItem.final_video_path)}`
    : undefined;

  const thumbnailSrc = scheduleItem?.thumbnail_path
    ? `${API_URL}/library/files/${encodeURIComponent(scheduleItem.thumbnail_path)}`
    : undefined;

  return (
    <>
      <Dialog open={!!post} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden">
          {/* Header */}
          <div className="px-6 pt-5 pb-3 border-b">
            <div className="flex items-center gap-3">
              {post.platform_picture && (
                <img src={post.platform_picture} alt="" className="size-8 rounded-full" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{post.platform_name || post.platform}</span>
                  <Badge variant="outline" className={stateColor(post.state)}>
                    {post.state}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatDate(post.publish_date)}
                </p>
              </div>
              {scheduleItem && (
                <Badge variant="secondary" className="text-xs shrink-0">
                  Posted via Edit Factory
                </Badge>
              )}
            </div>
          </div>

          {/* Body */}
          <div className="flex min-h-[300px] max-h-[500px]">
            {/* Left - Video/Thumbnail preview */}
            <div className="w-[280px] shrink-0 border-r bg-muted/50 flex items-center justify-center">
              {videoSrc ? (
                <video
                  src={videoSrc}
                  autoPlay
                  muted
                  loop
                  controls
                  className="w-full h-full object-contain"
                  style={{ aspectRatio: "9/16" }}
                />
              ) : thumbnailSrc ? (
                <img
                  src={thumbnailSrc}
                  alt="Thumbnail"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground p-6">
                  <Film className="size-10 opacity-40" />
                  <span className="text-sm font-medium">External post</span>
                  <span className="text-xs opacity-60">No video preview</span>
                </div>
              )}
            </div>

            {/* Right - Content & metadata */}
            <div className="flex-1 p-6 space-y-4 overflow-y-auto">
              {/* Content */}
              {content && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Content</h4>
                  <p className="text-sm whitespace-pre-wrap max-h-[200px] overflow-y-auto leading-relaxed">
                    {content}
                  </p>
                </div>
              )}

              {/* Metadata */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Details</h4>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant="outline" className={`w-fit ${stateColor(post.state)}`}>
                    {post.state}
                  </Badge>

                  <span className="text-muted-foreground">Scheduled</span>
                  <span>{formatDate(post.publish_date)}</span>

                  {post.release_url && (
                    <>
                      <span className="text-muted-foreground">Link</span>
                      <a
                        href={post.release_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1"
                      >
                        View on platform <ExternalLink className="size-3" />
                      </a>
                    </>
                  )}
                </div>
              </div>

              {/* Clip info (only for Edit Factory posts) */}
              {scheduleItem && (
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Clip Info</h4>
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                    {scheduleItem.clip_name && (
                      <>
                        <span className="text-muted-foreground">Clip</span>
                        <span>{scheduleItem.clip_name}</span>
                      </>
                    )}
                    <span className="text-muted-foreground">Clip ID</span>
                    <span className="font-mono text-xs">{scheduleItem.clip_id}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t flex justify-between">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="destructive"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="size-4 mr-2" />
              Delete Post
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this post?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this post and ALL related posts
              across all platforms in this group. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
