"use client";

import { validateStructure } from "@avero/schema";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Card, Empty, ErrorNote, inputCls, PageHeader, Spinner, Tag } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dateFr } from "@/lib/labels";
import { createClient } from "@/lib/supabase/client";

// Watch: for each topic, the issuing bodies a person chose to follow (never inferred), each with its current
// guideline, side by side. The check looks for newer versions (weekly, or on demand): a newer version is an alert
// that a person replaces or ignores. A fiche built from a replaced guideline is flagged to review.

interface TopicSource {
  id: string; topic_id: string; body_id: string; check_method: "pubmed" | "listing"; listing_url: string | null;
  current_title: string | null; current_year: number | null; current_ref: string | null; status: "actuelle" | "à vérifier"; checked_at: string | null;
}
interface Alert { id: string; topic_source_id: string; title: string; year: number | null; ref: string; found_at: string }
interface Replaced { topic_source_id: string; title: string | null; year: number | null; ref: string | null; replaced_by_title: string; replaced_by_year: number | null }
interface Topic { id: string; fr: string; group: string }
interface Body { id: string; name: string; region: string | null }
interface Proposal { title: string; version_year: number | null; doi: string | null; url: string; journal: string; on_listing?: boolean }
interface ToReview { id: string; title: string; source: string; replacedBy: string }

const WEEK = 7 * 24 * 3600 * 1000;
const refLink = (ref: string | null) => (ref ? (ref.startsWith("http") ? ref : `https://doi.org/${ref}`) : null);
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").trim();

/** Follow a body: topic, body, how to check it, and its current guideline (typed, or picked from the search). */
function FollowForm({ topics, bodies, onSaved }: { topics: Topic[]; bodies: Body[]; onSaved: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const { session } = useAuth();
  const [topic, setTopic] = useState("");
  const [body, setBody] = useState("");
  const [method, setMethod] = useState<"pubmed" | "listing">("pubmed");
  const [listing, setListing] = useState("");
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [ref, setRef] = useState("");
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const propose = () => {
    setBusy(true);
    setError(null);
    api<Proposal[]>(`/registry/propose?topic=${encodeURIComponent(topic)}&body=${encodeURIComponent(body)}`).then(setProposals, (e) => setError((e as Error).message)).finally(() => setBusy(false));
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("topic_sources").insert({
      topic_id: topic, body_id: body, check_method: method, listing_url: method === "listing" ? listing || null : null,
      current_title: title || null, current_year: year ? Number(year) : null, current_ref: ref || null, status: title ? "actuelle" : "à vérifier", created_by: session?.user.id,
    });
    setBusy(false);
    if (error) return setError(error.code === "23505" ? "This body is already followed for this topic." : error.message);
    setTitle("");
    setYear("");
    setRef("");
    setProposals(null);
    setBody("");
    onSaved();
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-semibold text-soft">Follow a body for a topic</h2>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <select className={inputCls} value={topic} onChange={(e) => (setTopic(e.target.value), setProposals(null))}>
          <option value="">Topic…</option>
          {topics.map((t) => <option key={t.id} value={t.id}>{t.fr}</option>)}
        </select>
        <select className={inputCls} value={body} onChange={(e) => (setBody(e.target.value), setProposals(null))}>
          <option value="">Body…</option>
          {bodies.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as "pubmed" | "listing")}>
          <option value="pubmed">Check through PubMed / Europe PMC</option>
          <option value="listing">Check the body&apos;s own page</option>
        </select>
      </div>
      {method === "listing" && <input className={inputCls} placeholder="The body's guidelines page (https://…)" value={listing} onChange={(e) => setListing(e.target.value)} />}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_90px_1fr]">
        <input className={inputCls} placeholder="Current guideline: title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className={inputCls} placeholder="Year" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} />
        <input className={inputCls} placeholder="DOI or link" value={ref} onChange={(e) => setRef(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || !topic || !body} onClick={propose} title="Finds this body's guidelines on the topic: you pick one">{busy && !proposals ? <Spinner /> : "Suggest from the search"}</Button>
        <Button variant="primary" disabled={busy || !topic || !body} onClick={save}>Follow</Button>
        {error && <span className="text-sm text-flag">{error}</span>}
      </div>
      {proposals && (proposals.length === 0 ? (
        <p className="text-sm text-muted">No guideline from this body found on this topic: type it in.</p>
      ) : (
        <ul className="flex flex-col rounded-lg border border-line">
          {proposals.map((p, i) => (
            <li key={i} className="flex items-start gap-3 border-t border-line px-3 py-2 first:border-0">
              <div className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{p.version_year}</span> · {p.title}
                <span className="block text-xs text-muted">{p.on_listing ? "official page" : p.journal}</span>
              </div>
              <Button className="h-8 text-xs" onClick={() => (setTitle(p.title), setYear(String(p.version_year ?? "")), setRef(p.doi ? `https://doi.org/${p.doi}` : p.url))}>Pick</Button>
            </li>
          ))}
        </ul>
      ))}
    </Card>
  );
}

export default function VeillePage() {
  const supabase = useMemo(() => createClient(), []);
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<TopicSource[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [replaced, setReplaced] = useState<Replaced[]>([]);
  const [lastCheck, setLastCheck] = useState<string | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [bodies, setBodies] = useState<Body[]>([]);
  const [toReview, setToReview] = useState<ToReview[]>([]);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoChecked = useRef(false);

  const load = useCallback(async () => {
    const [ts, al, rp, rc, fv] = await Promise.all([
      supabase.from("topic_sources").select("*").order("topic_id"),
      supabase.from("guideline_alerts").select("*").eq("state", "nouvelle").order("found_at", { ascending: false }),
      supabase.from("guidelines_replaced").select("*"),
      supabase.from("registry_checks").select("ran_at").order("ran_at", { ascending: false }).limit(1),
      supabase.from("fiche_versions").select("subject_id,version,content").order("version", { ascending: false }),
    ]);
    const failed = [ts, al, rp, rc, fv].find((r) => r.error);
    if (failed?.error) return setError(failed.error.message);
    setRows(ts.data as TopicSource[]);
    setAlerts(al.data as Alert[]);
    setReplaced(rp.data as Replaced[]);
    setLastCheck((rc.data as { ran_at: string }[])[0]?.ran_at ?? null);
    // Fiches whose source guideline (sources[].url, a DOI link) was replaced: to review.
    const old = new Map((rp.data as Replaced[]).filter((r) => r.ref).map((r) => [norm(r.ref), r]));
    const seen = new Set<string>();
    const review: ToReview[] = [];
    for (const v of fv.data as { subject_id: string; content: unknown }[]) {
      if (seen.has(v.subject_id)) continue;
      seen.add(v.subject_id);
      const { protocol: f } = validateStructure(v.content);
      if (!f) continue;
      for (const s of f.sources) {
        const r = s.url ? old.get(norm(s.url)) : undefined;
        if (r) review.push({ id: v.subject_id, title: f.meta.title, source: `${r.title ?? s.title} (${r.year ?? "?"})`, replacedBy: `${r.replaced_by_title} (${r.replaced_by_year ?? "?"})` });
      }
    }
    setToReview(review);
  }, [supabase]);

  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      const r = await api<{ checked: number; alerts: number; errors: string[] }>("/registry/check", { method: "POST" });
      setNote(`Checked ${r.checked} followed bod${r.checked === 1 ? "y" : "ies"}: ${r.alerts} new version${r.alerts === 1 ? "" : "s"}${r.errors.length ? `, ${r.errors.length} error(s)` : ""}.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load of the page's data
    void load();
    api<Topic[]>("/crawl/topics").then(setTopics, () => {});
    api<Body[]>("/registry/bodies").then(setBodies, () => {});
  }, [load]);
  // The weekly check: run when an admin opens the page and the last check is a week old.
  useEffect(() => {
    if (!isAdmin || !rows || rows.length === 0 || autoChecked.current) return;
    if (lastCheck && Date.now() - new Date(lastCheck).getTime() < WEEK) return;
    const t = setTimeout(() => {
      autoChecked.current = true; // marked when it starts: a re-render before then does not lose it
      void check();
    }, 0);
    return () => clearTimeout(t);
  }, [isAdmin, rows, lastCheck, check]);

  const decide = (id: string, action: "replace" | "ignore") => api(`/registry/alerts/${id}/${action}`, { method: "POST" }).then(load, (e) => setError((e as Error).message));
  const remove = async (id: string) => {
    if (!window.confirm("Stop following this body for this topic?")) return;
    const { error } = await supabase.from("topic_sources").delete().eq("id", id);
    if (error) setError(error.message);
    void load();
  };

  const topicName = (id: string) => topics.find((t) => t.id === id)?.fr ?? id;
  const bodyName = (id: string) => bodies.find((b) => b.id === id)?.name ?? id;
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
  const byTopic = new Map<string, TopicSource[]>();
  for (const r of rows ?? []) byTopic.set(r.topic_id, [...(byTopic.get(r.topic_id) ?? []), r]);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-8">
      <PageHeader title="Guideline watch"
        subtitle={lastCheck ? `Last checked ${dateFr(lastCheck)} · checked again every week` : "The followed bodies are checked every week for a newer guideline"}
        actions={isAdmin ? <Button variant="primary" disabled={checking || !rows?.length} onClick={check}>{checking ? <><Spinner /> Checking…</> : "Check now"}</Button> : undefined} />
      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}
      {note && <p className="mb-4 text-sm text-accent">{note}</p>}

      {alerts.length > 0 && (
        <Card className="mb-5 flex flex-col gap-2 border-caution/40 p-4">
          <h2 className="text-sm font-semibold text-caution">New versions to review ({alerts.length})</h2>
          {alerts.map((a) => {
            const r = byId.get(a.topic_source_id);
            return (
              <div key={a.id} className="flex flex-wrap items-start gap-3 border-t border-line py-2 first:border-0">
                <div className="min-w-0 flex-1 text-sm">
                  <div className="text-xs text-muted">{r ? `${topicName(r.topic_id)} · ${bodyName(r.body_id)}` : ""}</div>
                  <div>Current: {r?.current_title ? `${r.current_title} (${r.current_year ?? "?"})` : "not set"}</div>
                  <div className="font-medium text-ink">New: <a className="hover:underline" href={refLink(a.ref) ?? "#"} target="_blank" rel="noreferrer">{a.title}</a> ({a.year ?? "?"})</div>
                </div>
                {isAdmin && (
                  <div className="flex gap-2">
                    <Button variant="primary" className="h-8 text-xs" onClick={() => decide(a.id, "replace")}>Replace</Button>
                    <Button className="h-8 text-xs" onClick={() => decide(a.id, "ignore")}>Ignore</Button>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {toReview.length > 0 && (
        <Card className="mb-5 flex flex-col gap-2 border-flag/30 p-4">
          <h2 className="text-sm font-semibold text-flag">Fiches to review ({toReview.length})</h2>
          {toReview.map((r, i) => (
            <div key={i} className="border-t border-line py-2 text-sm first:border-0">
              <Link href={`/fiche/${r.id}`} className="font-medium text-ink hover:underline">{r.title}</Link>
              <div className="text-xs text-flag">Source updated: {r.source} replaced by {r.replacedBy}</div>
            </div>
          ))}
        </Card>
      )}

      {!rows ? (
        <div className="flex justify-center py-10 text-muted"><Spinner /></div>
      ) : rows.length === 0 ? (
        <Empty>No body followed yet. For each topic, staff pick the bodies whose guideline is the reference; every week Avero checks them for a newer version and flags the fiches built on a replaced one.</Empty>
      ) : (
        <div className="flex flex-col gap-5">
          {[...byTopic].map(([topic, list]) => (
            <section key={topic}>
              <h2 className="mb-2 text-base font-semibold text-ink">{topicName(topic)}</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {list.map((r) => {
                  const pending = alerts.some((a) => a.topic_source_id === r.id);
                  const history = replaced.filter((h) => h.topic_source_id === r.id);
                  return (
                    <Card key={r.id} className="flex flex-col gap-1.5 p-4">
                      <div className="flex items-center gap-2">
                        <span className="flex-1 font-semibold text-ink">{bodyName(r.body_id)}</span>
                        <Tag tone={r.status === "actuelle" && !pending ? "accent" : "caution"}>{pending ? "new version" : r.status === "actuelle" ? "current" : "to check"}</Tag>
                      </div>
                      {r.current_title ? (
                        <a href={refLink(r.current_ref) ?? "#"} target="_blank" rel="noreferrer" className="text-sm text-ink hover:underline">
                          <span className="font-semibold">{r.current_year ?? "?"}</span> · {r.current_title}
                        </a>
                      ) : (
                        <p className="text-sm text-caution">Current guideline not set</p>
                      )}
                      {history.map((h, i) => <p key={i} className="text-xs text-muted">Replaced: {h.title ?? "?"} ({h.year ?? "?"})</p>)}
                      <p className="text-xs text-muted">
                        {r.check_method === "pubmed" ? "PubMed / Europe PMC" : "the body's page"} · {r.checked_at ? `checked ${dateFr(r.checked_at)}` : "never checked"}
                      </p>
                      {isAdmin && <button type="button" className="self-start text-xs text-flag hover:underline" onClick={() => remove(r.id)}>Stop following</button>}
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {isAdmin && <div className="mt-6"><FollowForm topics={topics} bodies={bodies} onSaved={load} /></div>}
    </div>
  );
}
