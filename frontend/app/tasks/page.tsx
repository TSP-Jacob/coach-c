"use client";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { api, Task, TeamMember } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { openVoiceAssistant } from "@/lib/assistantBus";
import { Plus, Mic, X, Trash2, CalendarClock, ChevronDown, ChevronUp } from "lucide-react";

const STATUS_STYLE: Record<string, string> = {
  pending:     "text-blue-700 bg-blue-50 border-blue-200",
  in_progress: "text-amber-700 bg-amber-50 border-amber-200",
  done:        "text-green-700 bg-green-50 border-green-200",
};

function isOverdue(task: Task): boolean {
  if (!task.due_date || task.status === "done") return false;
  return task.due_date < new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string, language: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(language === "fr" ? "fr-CA" : "en-US", { month: "short", day: "numeric" });
}

export default function TasksPage() {
  const { agentId, role, language, t } = useAuth();
  const canManage = role === "admin" || role === "manager";
  const [showModal, setShowModal] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data: tasks = [], mutate } = useSWR<Task[]>(
    agentId ? ["tasks", agentId] : null,
    () => api.tasks.list(),
    { refreshInterval: 30_000 },
  );
  const { data: team = [] } = useSWR<TeamMember[]>(
    agentId && canManage ? ["agents-team"] : null,
    () => api.agents.team(),
  );

  function patch(id: string, updates: Partial<Task>) {
    mutate(prev => (prev ?? []).map(t => t.id === id ? { ...t, ...updates } : t), false);
  }

  async function handleStatusChange(id: string, status: string) {
    patch(id, { status: status as Task["status"] });
    try {
      await api.tasks.update(id, { status });
    } catch {
      mutate();
    }
  }

  async function handleDelete(id: string) {
    mutate(prev => (prev ?? []).filter(t => t.id !== id), false);
    try {
      await api.tasks.remove(id);
    } catch {
      mutate();
    }
  }

  // Manager/admin overview: every teammate, with their assigned tasks —
  // people with open work float to the top.
  const groups = useMemo(() => {
    if (!canManage) return [];
    const byAssignee = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!byAssignee.has(t.assigned_to)) byAssignee.set(t.assigned_to, []);
      byAssignee.get(t.assigned_to)!.push(t);
    }
    const seen = new Set<string>();
    const out: { id: string; name: string; tasks: Task[] }[] = [];
    for (const m of team) {
      seen.add(m.id);
      out.push({ id: m.id, name: m.name, tasks: byAssignee.get(m.id) ?? [] });
    }
    for (const [id, list] of byAssignee) {
      if (!seen.has(id)) out.push({ id, name: list[0]?.assignee?.name ?? "Unknown", tasks: list });
    }
    return out.sort((a, b) => {
      const aOpen = a.tasks.filter(t => t.status !== "done").length;
      const bOpen = b.tasks.filter(t => t.status !== "done").length;
      return bOpen - aOpen;
    });
  }, [tasks, team, canManage]);

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="border-b border-warm-border pb-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-4xl font-serif font-bold text-charcoal">{t("Tasks")}</h1>
          <p className="text-xs text-muted mt-1 tracking-widest uppercase">
            {tasks.filter(x => x.status !== "done").length} {t("open")} · {tasks.length} {t("total")}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 text-sm px-4 py-2.5 bg-brand text-white hover:opacity-90 transition-opacity"
          >
            <Plus size={15} /> {t("New Task")}
          </button>
        )}
      </div>

      {canManage ? (
        <div className="space-y-4">
          {groups.length === 0 && (
            <div className="bg-white border border-warm-border px-6 py-8">
              <p className="text-muted text-sm italic font-serif">{t("No teammates yet.")}</p>
            </div>
          )}
          {groups.map(g => {
            const open = g.tasks.filter(x => x.status !== "done").length;
            const isOpen = expanded[g.id] ?? open > 0;
            return (
              <div key={g.id} className="bg-white border border-warm-border">
                <button
                  onClick={() => setExpanded(prev => ({ ...prev, [g.id]: !isOpen }))}
                  className="w-full flex items-center justify-between px-6 py-4 hover:bg-cream transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium text-charcoal">{g.name}</p>
                    <span className="text-xs text-muted">{open} {t("open")} · {g.tasks.length} {t("total")}</span>
                  </div>
                  {isOpen
                    ? <ChevronUp size={15} className="text-muted" />
                    : <ChevronDown size={15} className="text-muted" />
                  }
                </button>
                {isOpen && (
                  <div className="border-t border-warm-border divide-y divide-warm-border">
                    {g.tasks.length === 0 && (
                      <p className="text-sm text-muted italic px-6 py-5">{t("No tasks assigned yet.")}</p>
                    )}
                    {g.tasks.map(task => (
                      <TaskRow key={task.id} task={task} canManage onStatusChange={handleStatusChange} onDelete={handleDelete} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white border border-warm-border divide-y divide-warm-border">
          {tasks.length === 0 && (
            <p className="text-muted text-sm px-6 py-8 italic font-serif">{t("No tasks assigned to you right now.")}</p>
          )}
          {tasks.map(task => (
            <TaskRow key={task.id} task={task} canManage={false} onStatusChange={handleStatusChange} />
          ))}
        </div>
      )}

      {showModal && canManage && (
        <NewTaskModal team={team} onClose={() => setShowModal(false)} onCreated={() => mutate()} />
      )}
    </div>
  );
}

function TaskRow({ task, canManage, onStatusChange, onDelete }: {
  task: Task;
  canManage: boolean;
  onStatusChange: (id: string, status: string) => void;
  onDelete?: (id: string) => void;
}) {
  const { language, t } = useAuth();
  const overdue = isOverdue(task);
  return (
    <div className="flex items-start justify-between gap-4 px-6 py-4">
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${task.status === "done" ? "text-muted line-through" : "text-charcoal"}`}>
          {task.title}
        </p>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {task.due_date && (
            <span className={`text-xs flex items-center gap-1 ${overdue ? "text-brand font-medium" : "text-muted"}`}>
              <CalendarClock size={11} /> {fmtDate(task.due_date, language)}{overdue ? ` (${t("overdue")})` : ""}
            </span>
          )}
          {task.creator?.name && (
            <span className="text-xs text-muted">{t("from")} {task.creator.name}</span>
          )}
        </div>
        {task.description && (
          <p className="text-xs text-muted mt-1.5 leading-relaxed">{task.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <select
          value={task.status}
          onChange={e => onStatusChange(task.id, e.target.value)}
          className={`text-xs px-2 py-1.5 border focus:outline-none ${STATUS_STYLE[task.status]}`}
        >
          <option value="pending">{t("Pending")}</option>
          <option value="in_progress">{t("In Progress")}</option>
          <option value="done">{t("Done")}</option>
        </select>
        {canManage && onDelete && (
          <button onClick={() => onDelete(task.id)} className="text-muted hover:text-brand transition-colors p-1">
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function NewTaskModal({ team, onClose, onCreated }: {
  team: TeamMember[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useAuth();
  const [manual, setManual] = useState(false);
  const [assignedTo, setAssignedTo] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!assignedTo || !title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.tasks.create({
        assigned_to: assignedTo,
        title: title.trim(),
        description: description.trim() || undefined,
        due_date: dueDate || undefined,
      });
      onCreated();
      onClose();
    } catch {
      setError(t("Couldn't create the task. Try again."));
    } finally {
      setSaving(false);
    }
  }

  function startVoice() {
    openVoiceAssistant();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4" onClick={onClose}>
      <div className="bg-white border border-warm-border shadow-xl w-full max-w-md p-6 space-y-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-serif font-bold text-charcoal">{t("New Task")}</h2>
          <button onClick={onClose} className="text-muted hover:text-charcoal transition-colors">
            <X size={16} />
          </button>
        </div>

        {!manual ? (
          <div className="space-y-4">
            <button
              onClick={startVoice}
              className="w-full flex items-center justify-center gap-2 text-sm bg-brand text-white py-3 hover:opacity-90 transition-opacity"
            >
              <Mic size={16} /> {t("Create with Voice")}
            </button>
            <p className="text-xs text-muted text-center leading-relaxed">
              {t("Say who it's for, what needs doing, and — if there is one — when it's due.")}
            </p>
            <button
              onClick={() => setManual(true)}
              className="w-full text-xs text-muted hover:text-brand transition-colors underline underline-offset-2"
            >
              {t("or fill it in manually")}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] tracking-widest uppercase text-muted block mb-1.5">{t("Assign To")}</label>
              <select
                value={assignedTo}
                onChange={e => setAssignedTo(e.target.value)}
                className="w-full text-sm border border-warm-border px-3 py-2 focus:outline-none focus:border-brand"
              >
                <option value="">{t("Select teammate…")}</option>
                {team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] tracking-widest uppercase text-muted block mb-1.5">{t("Title")}</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={t("e.g. Call back the Hendersons")}
                className="w-full text-sm border border-warm-border px-3 py-2 focus:outline-none focus:border-brand"
              />
            </div>
            <div>
              <label className="text-[10px] tracking-widest uppercase text-muted block mb-1.5">{t("Description (optional)")}</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={2}
                className="w-full text-sm border border-warm-border px-3 py-2 focus:outline-none focus:border-brand resize-none"
              />
            </div>
            <div>
              <label className="text-[10px] tracking-widest uppercase text-muted block mb-1.5">{t("Due Date (optional)")}</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full text-sm border border-warm-border px-3 py-2 focus:outline-none focus:border-brand"
              />
            </div>
            {error && <p className="text-xs text-brand">{error}</p>}
            <div className="flex items-center justify-between pt-1">
              <button onClick={() => setManual(false)} className="text-xs text-muted hover:text-brand transition-colors">
                {t("← use voice instead")}
              </button>
              <button
                onClick={submit}
                disabled={!assignedTo || !title.trim() || saving}
                className="text-sm px-4 py-2 bg-brand text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {saving ? t("Creating…") : t("Create Task")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
