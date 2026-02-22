"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DollarSign,
  TrendingUp,
  Mic,
  Video,
  RefreshCw,
  ChevronLeft,
  AlertCircle,
  CheckCircle2,
  Settings,
  ExternalLink,
  XCircle,
  Loader2,
  BarChart3,
} from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { apiGetWithRetry, handleApiError } from "@/lib/api";

interface CostSummary {
  source: string;
  totals: {
    elevenlabs: number;
    gemini: number;
  };
  total_all: number;
  today: {
    elevenlabs: number;
    gemini: number;
  };
  entry_count: number;
  last_entries: CostEntry[];
}

interface CostEntry {
  id?: string;
  job_id: string;
  service: string;
  operation: string;
  units: number;
  estimated_cost: number;
  details?: Record<string, unknown>;
  created_at?: string;
}

interface UsageStats {
  elevenlabs?: {
    characters_used: number;
    characters_limit: number;
    characters_remaining: number;
    usage_percent: number;
    tier: string;
    estimated_cost_usd: number;
  };
  gemini?: {
    configured: boolean;
    model: string;
    note: string;
    estimated_cost_per_video: number;
  };
  errors: string[];
}

interface GeminiStatus {
  configured: boolean;
  connected: boolean;
  model: string | null;
  error: string | null;
  test_response?: string;
  balance_url: string;
  billing_url: string;
}

export default function UsagePage() {
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus | null>(null);
  const [allEntries, setAllEntries] = useState<CostEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testingGemini, setTestingGemini] = useState(false);
  const [budget, setBudget] = useState<number>(50); // Default $50 budget
  const [showAllEntries, setShowAllEntries] = useState(false);

  const fetchGeminiStatus = useCallback(async () => {
    setTestingGemini(true);
    try {
      const res = await apiGetWithRetry("/gemini/status");
      const data = await res.json();
      setGeminiStatus(data);
    } catch (error) {
      handleApiError(error, "Eroare la verificarea statusului Gemini");
    } finally {
      setTestingGemini(false);
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [costsRes, usageRes] = await Promise.all([
        apiGetWithRetry("/costs"),
        apiGetWithRetry("/usage"),
      ]);

      const costsData = await costsRes.json();
      setCostSummary(costsData);

      const usageData = await usageRes.json();
      setUsageStats(usageData);

      // Also fetch Gemini status
      await fetchGeminiStatus();
    } catch (err) {
      handleApiError(err, "Eroare la incarcarea statisticilor");
      setError("Nu s-a putut conecta la server. Verifică că backend-ul rulează pe port 8000.");
    } finally {
      setLoading(false);
    }
  }, [fetchGeminiStatus]);

  const fetchAllEntries = async () => {
    try {
      const res = await apiGetWithRetry("/costs/all");
      const data = await res.json();
      setAllEntries(data.entries || []);
      setShowAllEntries(true);
    } catch (error) {
      handleApiError(error, "Eroare la incarcarea costurilor");
    }
  };

  useEffect(() => {
    fetchData();
    // Load saved budget from localStorage
    const savedBudget = localStorage.getItem("editai_budget");
    if (savedBudget) {
      setBudget(parseFloat(savedBudget));
    }
  }, [fetchData]);

  const saveBudget = (value: number) => {
    setBudget(value);
    localStorage.setItem("editai_budget", value.toString());
  };

  const totalSpent = costSummary?.total_all || 0;
  const budgetRemaining = budget - totalSpent;
  const budgetUsedPercent = Math.min((totalSpent / budget) * 100, 100);

  const formatCost = (cost: number) => `$${cost.toFixed(4)}`;
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleString("ro-RO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/library">
              <Button variant="ghost" size="icon">
                <ChevronLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Usage & Costs</h1>
              <p className="text-muted-foreground">Monitor API usage and spending</p>
            </div>
          </div>
          <Button
            onClick={fetchData}
            variant="outline"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Error Alert */}
        {error && (
          <Card className="bg-destructive/10 border-destructive/30 mb-8">
            <CardContent className="flex items-center gap-3 py-4">
              <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
              <div className="flex-1">
                <p className="text-destructive font-medium">{error}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchData}
                className="border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Budget Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {/* Budget Card */}
          <Card className="bg-card border-border col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-foreground flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-green-500" />
                Budget Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <Label className="text-muted-foreground w-24">Budget ($):</Label>
                  <Input
                    type="number"
                    value={budget}
                    onChange={(e) => saveBudget(parseFloat(e.target.value) || 0)}
                    className="w-24 bg-muted/50 border-border"
                    min={0}
                    step={10}
                  />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">
                      Spent: <span className="text-foreground font-bold">{formatCost(totalSpent)}</span>
                    </span>
                    <span className="text-muted-foreground">
                      Remaining:{" "}
                      <span className={`font-bold ${budgetRemaining < 0 ? "text-destructive" : "text-green-500"}`}>
                        {formatCost(budgetRemaining)}
                      </span>
                    </span>
                  </div>
                  <Progress
                    value={budgetUsedPercent}
                    className="h-3"
                  />
                  <p className="text-xs text-muted-foreground mt-1 text-right">
                    {budgetUsedPercent.toFixed(1)}% used
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Today's Spending */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-foreground text-lg flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-yellow-500" />
                Today
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {formatCost((costSummary?.today?.elevenlabs || 0) + (costSummary?.today?.gemini || 0))}
              </div>
              <div className="text-sm text-muted-foreground mt-2 space-y-1">
                <div className="flex justify-between">
                  <span>ElevenLabs:</span>
                  <span>{formatCost(costSummary?.today?.elevenlabs || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Gemini:</span>
                  <span>{formatCost(costSummary?.today?.gemini || 0)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Total Jobs */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-foreground text-lg flex items-center gap-2">
                <Video className="h-4 w-4 text-blue-500" />
                Total Jobs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {costSummary?.entry_count || 0}
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                API calls tracked
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Service Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {/* ElevenLabs */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <Mic className="h-5 w-5 text-primary" />
                ElevenLabs TTS
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Text-to-Speech usage
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Total Spent:</span>
                  <span className="text-2xl font-bold text-foreground">
                    {formatCost(costSummary?.totals?.elevenlabs || 0)}
                  </span>
                </div>
                {usageStats?.elevenlabs && (
                  <>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Characters Used:</span>
                        <span className="text-foreground">
                          {usageStats.elevenlabs.characters_used?.toLocaleString() || 0} /{" "}
                          {usageStats.elevenlabs.characters_limit?.toLocaleString() || 0}
                        </span>
                      </div>
                      <Progress
                        value={usageStats.elevenlabs.usage_percent || 0}
                        className="h-2"
                      />
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Remaining:</span>
                      <span className="text-green-500 font-medium">
                        {usageStats.elevenlabs.characters_remaining?.toLocaleString() || 0} chars
                      </span>
                    </div>
                    <Badge variant="outline">
                      {usageStats.elevenlabs.tier} Plan
                    </Badge>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Gemini */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-foreground flex items-center gap-2">
                <Video className="h-5 w-5 text-blue-500" />
                Gemini Vision
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Video analysis usage
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Total Spent:</span>
                  <span className="text-2xl font-bold text-foreground">
                    {formatCost(costSummary?.totals?.gemini || 0)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Rate:</span>
                  <span className="text-foreground">~$0.02 / frame</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Est. per Video:</span>
                  <span className="text-foreground">~$1.20 (60 frames)</span>
                </div>

                {/* Gemini Status - real-time check */}
                <div className="pt-2 border-t border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted-foreground">Status:</span>
                    {testingGemini ? (
                      <Badge variant="outline" className="border-yellow-500 text-yellow-500">
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Testing...
                      </Badge>
                    ) : geminiStatus?.connected ? (
                      <Badge variant="outline" className="border-green-500 text-green-500">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Connected
                      </Badge>
                    ) : geminiStatus?.configured ? (
                      <Badge variant="outline" className="border-yellow-500 text-yellow-500">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        {geminiStatus.error || "Not connected"}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-destructive text-destructive">
                        <XCircle className="h-3 w-3 mr-1" />
                        Not configured
                      </Badge>
                    )}
                  </div>

                  {geminiStatus?.model && (
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-muted-foreground">Model:</span>
                      <span className="text-foreground font-mono text-xs">{geminiStatus.model}</span>
                    </div>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2"
                    onClick={fetchGeminiStatus}
                    disabled={testingGemini}
                  >
                    {testingGemini ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Test Connection
                  </Button>
                </div>

                {/* Links to check balance */}
                <div className="pt-2 border-t border-border space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Check your Gemini credit balance:
                  </p>
                  <div className="flex gap-2">
                    <a
                      href={geminiStatus?.balance_url || "https://aistudio.google.com/apikey"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1"
                    >
                      <Button variant="outline" size="sm" className="w-full text-xs">
                        <ExternalLink className="h-3 w-3 mr-1" />
                        AI Studio
                      </Button>
                    </a>
                    <a
                      href={geminiStatus?.billing_url || "https://console.cloud.google.com/billing"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1"
                    >
                      <Button variant="outline" size="sm" className="w-full text-xs">
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Cloud Billing
                      </Button>
                    </a>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Jobs Table */}
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-foreground">Cost History</CardTitle>
              <CardDescription className="text-muted-foreground">
                {showAllEntries ? "All API calls" : "Last 10 API calls"}
              </CardDescription>
            </div>
            {!showAllEntries && (
              <Button
                variant="outline"
                size="sm"
                onClick={fetchAllEntries}
              >
                Show All
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="text-muted-foreground">Date</TableHead>
                  <TableHead className="text-muted-foreground">Job ID</TableHead>
                  <TableHead className="text-muted-foreground">Service</TableHead>
                  <TableHead className="text-muted-foreground">Operation</TableHead>
                  <TableHead className="text-muted-foreground text-right">Units</TableHead>
                  <TableHead className="text-muted-foreground text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(showAllEntries ? allEntries : costSummary?.last_entries || []).map(
                  (entry, idx) => (
                    <TableRow key={entry.id || idx} className="border-border">
                      <TableCell className="text-foreground text-sm">
                        {formatDate(entry.created_at)}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {entry.job_id?.slice(0, 8)}...
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            entry.service === "elevenlabs"
                              ? "border-primary text-primary"
                              : "border-blue-500 text-blue-500"
                          }
                        >
                          {entry.service === "elevenlabs" ? (
                            <Mic className="h-3 w-3 mr-1" />
                          ) : (
                            <Video className="h-3 w-3 mr-1" />
                          )}
                          {entry.service}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-foreground">{entry.operation}</TableCell>
                      <TableCell className="text-foreground text-right">
                        {entry.units?.toLocaleString() || "-"}
                        <span className="text-muted-foreground text-xs ml-1">
                          {entry.service === "elevenlabs" ? "chars" : "frames"}
                        </span>
                      </TableCell>
                      <TableCell className="text-green-500 text-right font-medium">
                        {formatCost(entry.estimated_cost || 0)}
                      </TableCell>
                    </TableRow>
                  )
                )}
                {(!costSummary?.last_entries || costSummary.last_entries.length === 0) &&
                  !showAllEntries && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-4">
                        <EmptyState
                          icon={<BarChart3 className="h-6 w-6" />}
                          title="Nicio utilizare"
                          description="Costurile API vor fi inregistrate aici."
                        />
                      </TableCell>
                    </TableRow>
                  )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Errors */}
        {usageStats?.errors && usageStats.errors.length > 0 && (
          <Card className="bg-destructive/10 border-destructive/30 mt-4">
            <CardHeader>
              <CardTitle className="text-destructive flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                API Errors
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {usageStats.errors.map((error, idx) => (
                  <li key={idx} className="text-destructive text-sm">
                    {error}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
