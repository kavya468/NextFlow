"use client";

import { useState } from "react";
import { Copy, Plus, Trash2, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc/client";

export default function ApiKeysPage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [open, setOpen] = useState(false);
  const [newKey, setNewKey] = useState<{ key: string; keyId: string } | null>(null);
  const [rateLimitEnabled, setRateLimitEnabled] = useState(false);
  const [rateLimitCount, setRateLimitCount] = useState(100);
  const [rateLimitDuration, setRateLimitDuration] = useState<"1m"|"10m"|"1h"|"24h">("1h");

  const utils = trpc.useUtils();
  const { data: keys, isLoading } = trpc.apiKeys.list.useQuery();
  
  const createMutation = trpc.apiKeys.create.useMutation({
    onSuccess: (data) => {
      setNewKey(data);
      utils.apiKeys.list.invalidate();
      setName("");
      setDescription("");
    },
    onError: (error) => {
      alert(`Failed to create API key: ${error.message}`);
    },
  });

  const revokeMutation = trpc.apiKeys.revoke.useMutation({
    onSuccess: () => {
      utils.apiKeys.list.invalidate();
    },
    onError: (error) => {
      alert(`Failed to revoke API key: ${error.message}`);
    },
  });

  const handleCreate = () => {
    if (!name.trim()) return;
    createMutation.mutate({
      name,
      description,
      ...(rateLimitEnabled && {
        rateLimit: {
          limit: rateLimitCount,
          duration: rateLimitDuration,
        },
      }),
    });
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold">API Keys</h1>
        <p className="text-muted-foreground mt-2">
          Manage your API keys to authenticate requests to the NextFlow REST API.
          <a href="/docs/api-reference/openapi" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline ml-1">View Documentation</a>
        </p>
      </div>

      <Dialog open={open} onOpenChange={(open) => {
          setOpen(open);
          if (!open) {
            setNewKey(null);
            setRateLimitEnabled(false);
            setRateLimitCount(100);
            setRateLimitDuration("1h");
          }
        }}>
        <DialogTrigger render={<Button onClick={() => setNewKey(null)} />}>
          <Plus className="w-4 h-4 mr-2" /> Generate Key
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{newKey ? "Your API Key" : "Create API Key"}</DialogTitle>
            <DialogDescription>
              {newKey ? "Please copy this key now. You won't be able to see it again." : "Provide a name for your new API key to help you identify it later."}
            </DialogDescription>
          </DialogHeader>
          
          {newKey ? (
            <div className="space-y-4 pt-4">
              <div className="flex items-center space-x-2">
                <Input value={newKey.key} readOnly className="font-mono bg-muted" />
                <Button variant="outline" size="icon" onClick={() => navigator.clipboard.writeText(newKey.key)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <Button className="w-full" onClick={() => setOpen(false)}>Done</Button>
            </div>
          ) : (
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <Input placeholder="e.g. Production Key" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Description (optional)</label>
                <Input placeholder="e.g. Used in my Next.js frontend" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Rate Limiting</label>
                  <Switch
                    checked={rateLimitEnabled}
                    onCheckedChange={setRateLimitEnabled}
                  />
                </div>

                {rateLimitEnabled && (
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-1">
                      <label className="text-xs text-muted-foreground">Requests</label>
                      <Input
                        type="number"
                        min={1}
                        max={10000}
                        value={rateLimitCount}
                        onChange={(e) => setRateLimitCount(Number(e.target.value))}
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <label className="text-xs text-muted-foreground">Per</label>
                      <Select
                        value={rateLimitDuration}
                        onValueChange={(v) => setRateLimitDuration(v as any)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1m">1 minute</SelectItem>
                          <SelectItem value="10m">10 minutes</SelectItem>
                          <SelectItem value="1h">1 hour</SelectItem>
                          <SelectItem value="24h">24 hours</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  {rateLimitEnabled
                    ? `This key can make ${rateLimitCount} requests per ${rateLimitDuration}`
                    : "No rate limit — key can make unlimited requests"}
                </p>
              </div>

              <Button className="w-full" onClick={handleCreate} disabled={!name.trim() || createMutation.isPending}>
                {createMutation.isPending ? "Generating..." : "Generate Key"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="border rounded-md">
        <table className="w-full caption-bottom text-sm">
          <thead className="[&_tr]:border-b">
            <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
              <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Name</th>
              <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Secret Key</th>
              <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Created</th>
              <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">Last Used</th>
              <th className="h-10 px-4 text-right align-middle font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {isLoading ? (
              <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                <td colSpan={5} className="p-4 align-middle text-center py-8">Loading...</td>
              </tr>
            ) : keys?.length === 0 ? (
              <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                <td colSpan={5} className="p-4 align-middle text-center py-8 text-muted-foreground">No API keys found.</td>
              </tr>
            ) : (
              keys?.map((key: any) => (
                <tr key={key.keyId} className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                  <td className="p-4 align-middle font-medium">
                    <div className="flex items-center space-x-2">
                      <Key className="w-4 h-4 text-muted-foreground" />
                      <span>{key.name}</span>
                    </div>
                  </td>
                  <td className="p-4 align-middle"><code className="px-2 py-1 bg-muted rounded font-mono text-xs">{key.maskedKey}</code></td>
                  <td className="p-4 align-middle text-muted-foreground">
                    {new Date(key.createdAt).toLocaleDateString()}
                  </td>
                  <td className="p-4 align-middle text-muted-foreground">
                    {key.lastUsed ? new Date(key.lastUsed).toLocaleDateString() : "Never"}
                  </td>
                  <td className="p-4 align-middle text-right">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        if (confirm("Are you sure you want to revoke this key?")) {
                          revokeMutation.mutate({ keyId: key.keyId });
                        }
                      }}
                      disabled={revokeMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
