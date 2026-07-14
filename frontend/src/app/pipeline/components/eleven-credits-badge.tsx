"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, RefreshCw } from "lucide-react";

export type ElevenCreditsProps = {
  credits: {
    label: string;
    tier: string;
    credits_used: number;
    credits_reserved: number;
    credit_limit: number;
    credits_remaining: number;
    usage_percent: number;
    last_error: string | null;
    period_end?: string | null;
  } | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
};

export function ElevenCreditsBadge({ credits, loading, error, onRefresh }: ElevenCreditsProps) {
  if (loading && !credits) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading credits...
      </div>
    );
  }
  if (error || !credits) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {error || "No ElevenLabs allowance"}
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRefresh} title="Retry">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
    );
  }

  const pct = credits.usage_percent;
  const unlimited = credits.credit_limit < 0;
  const remainingPct = unlimited ? 100 : credits.credit_limit > 0 ? 100 - pct : 0;
  // green >25% remaining, amber 10-25%, red <10%
  const color = remainingPct > 25 ? "text-success" : remainingPct > 10 ? "text-amber-500" : "text-red-500";

  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] uppercase">
            {credits.tier}
          </Badge>
          <span className={`text-xs font-medium ${color}`}>
            {unlimited
              ? "Unlimited credits"
              : `${credits.credits_remaining.toLocaleString()} credits left`}
          </span>
        </div>
        <div className="w-40">
          <Progress value={unlimited ? 0 : pct} className="h-1.5" />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
            <span>
              {credits.credits_used.toLocaleString()}
              {credits.credits_reserved > 0
                ? ` + ${credits.credits_reserved.toLocaleString()} reserved`
                : ""}
            </span>
            <span>{unlimited ? "∞" : credits.credit_limit.toLocaleString()}</span>
          </div>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={onRefresh}
        title="Refresh your monthly credit allowance"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
}
