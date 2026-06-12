"use client";

import {
  Banknote,
  Check,
  CircleDollarSign,
  Database,
  HandCoins,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  LogOut,
  Users
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Expense, Member, Payment, RoomUser, SessionUser, Settlement } from "./types";

const roomSecretCode = "roomNumber301";
const localMembersKey = "room-splitter-members";
const localExpensesKey = "room-splitter-expenses";
const localPaymentsKey = "room-splitter-payments";
const localUsersKey = "room-splitter-users";
const localSessionKey = "room-splitter-session";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2
});

function makeId() {
  return crypto.randomUUID();
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function calculateShare(amount: number, count: number) {
  return roundMoney(amount / count);
}

function makeShares(amount: number, participantIds: string[]) {
  const share = calculateShare(amount, participantIds.length);
  return participantIds.reduce<Record<string, number>>((acc, id, index) => {
    const isLast = index === participantIds.length - 1;
    const used = share * (participantIds.length - 1);
    acc[id] = isLast ? roundMoney(amount - used) : share;
    return acc;
  }, {});
}

function loadLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : fallback;
}

function saveLocal<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

async function hashText(value: string) {
  const bytes = new TextEncoder().encode(value);
  const buffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function memberName(members: Member[], id: string) {
  return members.find((member) => member.id === id)?.name ?? "Unknown";
}

function calculateBalances(members: Member[], expenses: Expense[], payments: Payment[]) {
  const balances = Object.fromEntries(members.map((member) => [member.id, 0]));

  expenses.forEach((expense) => {
    balances[expense.payer_id] = (balances[expense.payer_id] ?? 0) + expense.amount;

    Object.entries(expense.shares).forEach(([memberId, share]) => {
      balances[memberId] = (balances[memberId] ?? 0) - share;
    });
  });

  payments.filter((payment) => payment.status === "verified").forEach((payment) => {
    balances[payment.from_id] = (balances[payment.from_id] ?? 0) + payment.amount;
    balances[payment.to_id] = (balances[payment.to_id] ?? 0) - payment.amount;
  });

  return Object.fromEntries(
    Object.entries(balances).map(([id, value]) => [id, roundMoney(value)])
  );
}

function calculateSettlements(balances: Record<string, number>): Settlement[] {
  const debtors = Object.entries(balances)
    .filter(([, amount]) => amount < -0.01)
    .map(([id, amount]) => ({ id, amount: Math.abs(amount) }));
  const creditors = Object.entries(balances)
    .filter(([, amount]) => amount > 0.01)
    .map(([id, amount]) => ({ id, amount }));
  const settlements: Settlement[] = [];

  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = roundMoney(Math.min(debtor.amount, creditor.amount));

    settlements.push({ from: debtor.id, to: creditor.id, amount });

    debtor.amount = roundMoney(debtor.amount - amount);
    creditor.amount = roundMoney(creditor.amount - amount);

    if (debtor.amount <= 0.01) debtorIndex += 1;
    if (creditor.amount <= 0.01) creditorIndex += 1;
  }

  return settlements;
}

export default function Home() {
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authName, setAuthName] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [authStatus, setAuthStatus] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [payerId, setPayerId] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("");

  const balances = useMemo(
    () => calculateBalances(members, expenses, payments),
    [members, expenses, payments]
  );
  const settlements = useMemo(() => calculateSettlements(balances), [balances]);
  const pendingPayments = useMemo(
    () => payments.filter((payment) => payment.status === "pending"),
    [payments]
  );
  const verifiedPayments = useMemo(
    () => payments.filter((payment) => payment.status === "verified"),
    [payments]
  );
  const totalSpent = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.amount, 0),
    [expenses]
  );

  useEffect(() => {
    setCurrentUser(loadLocal<SessionUser | null>(localSessionKey, null));
    void loadData();
  }, []);

  useEffect(() => {
    if (currentUser?.member_id && members.some((member) => member.id === currentUser.member_id)) {
      setPayerId(currentUser.member_id);
    } else if (!payerId && members.length > 0) {
      setPayerId(members[0].id);
    }

    if (selectedMemberIds.length === 0 && members.length > 0) {
      setSelectedMemberIds(members.map((member) => member.id));
    }
  }, [currentUser?.member_id, members, payerId, selectedMemberIds.length]);

  useEffect(() => {
    setPaymentAmounts((current) => {
      const next: Record<string, string> = {};
      settlements.forEach((settlement) => {
        const key = settlementKey(settlement);
        next[key] = current[key] ?? String(settlement.amount);
      });
      return next;
    });
  }, [settlements]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    const channel = client
      .channel("room-splitter-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, () => {
        void loadData(false);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "room_members" }, () => {
        void loadData(false);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => {
        void loadData(false);
      })
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, []);

  async function loadData(showSpinner = true) {
    if (showSpinner) setIsLoading(true);
    setStatus("");

    try {
      if (supabase) {
        const [
          { data: memberRows, error: memberError },
          { data: expenseRows, error: expenseError },
          { data: paymentRows, error: paymentError }
        ] = await Promise.all([
          supabase.from("room_members").select("*").order("created_at", { ascending: true }),
          supabase.from("expenses").select("*").order("created_at", { ascending: false }),
          supabase.from("payments").select("*").order("created_at", { ascending: false })
        ]);

        if (memberError) throw memberError;
        if (expenseError) throw expenseError;
        if (paymentError) throw paymentError;

        setMembers((memberRows ?? []) as Member[]);
        setExpenses((expenseRows ?? []).map(normalizeExpense));
        setPayments((paymentRows ?? []).map(normalizePayment));
        return;
      }

      const localMembers = loadLocal<Member[]>(localMembersKey, []);
      const localExpenses = loadLocal<Expense[]>(localExpensesKey, []);
      const localPayments = loadLocal<Payment[]>(localPaymentsKey, []);
      saveLocal(localMembersKey, localMembers);
      setMembers(localMembers);
      setExpenses(localExpenses);
      setPayments(localPayments);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load data.");
    } finally {
      setIsLoading(false);
    }
  }

  function normalizeExpense(expense: Expense) {
    return {
      ...expense,
      amount: Number(expense.amount),
      participant_ids: expense.participant_ids ?? [],
      shares: expense.shares ?? {}
    };
  }

  function normalizePayment(payment: Payment) {
    return {
      ...payment,
      amount: Number(payment.amount),
      status: payment.status ?? "verified",
      verified_at: payment.verified_at ?? null
    };
  }

  function settlementKey(settlement: Settlement) {
    return `${settlement.from}-${settlement.to}`;
  }

  async function findOrCreateMember(name: string) {
    const existingMember = members.find(
      (member) => member.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (existingMember) return existingMember;

    if (supabase) {
      const { data, error } = await supabase.from("room_members").insert({ name }).select().single();
      if (error) throw error;
      const member = data as Member;
      setMembers((current) => [...current, member]);
      return member;
    }

    const member = { id: makeId(), name, created_at: new Date().toISOString() };
    const nextMembers = [...members, member];
    setMembers(nextMembers);
    saveLocal(localMembersKey, nextMembers);
    return member;
  }

  async function handleAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = authName.trim();
    const password = authPassword.trim();
    const secretCode = authCode.trim();

    if (!name || !password) {
      setAuthStatus("Enter name and password.");
      return;
    }

    if (authMode === "signup" && !secretCode) {
      setAuthStatus("Enter the secret code.");
      return;
    }

    if (authMode === "signup" && secretCode !== roomSecretCode) {
      setAuthStatus("Secret code is wrong.");
      return;
    }

    setIsSaving(true);
    setAuthStatus("");

    try {
      const passwordHash = await hashText(password);

      if (authMode === "signup") {
        const member = await findOrCreateMember(name);

        if (supabase) {
          const { data: existingUser, error: lookupError } = await supabase
            .from("room_users")
            .select("*")
            .eq("name", name)
            .maybeSingle();

          if (lookupError) throw lookupError;
          if (existingUser) {
            setAuthStatus("User already exists. Login instead.");
            return;
          }

          const { data, error } = await supabase
            .from("room_users")
            .insert({
              name,
              member_id: member.id,
              password_hash: passwordHash,
              room_code: secretCode
            })
            .select()
            .single();

          if (error) throw error;

          const user = data as RoomUser;
          loginUser({ id: user.id, name: user.name, member_id: user.member_id });
        } else {
          const users = loadLocal<RoomUser[]>(localUsersKey, []);
          const exists = users.some((user) => user.name.toLowerCase() === name.toLowerCase());

          if (exists) {
            setAuthStatus("User already exists. Login instead.");
            return;
          }

          const user: RoomUser = {
            id: makeId(),
            name,
            member_id: member.id,
            password_hash: passwordHash,
            room_code: secretCode,
            created_at: new Date().toISOString()
          };
          saveLocal(localUsersKey, [...users, user]);
          loginUser({ id: user.id, name: user.name, member_id: user.member_id });
        }

        setStatus(`Welcome, ${name}.`);
        return;
      }

      if (supabase) {
        const { data, error } = await supabase
          .from("room_users")
          .select("*")
          .eq("name", name)
          .eq("password_hash", passwordHash)
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          setAuthStatus("Login failed. Check name and password.");
          return;
        }

        const user = data as RoomUser;
        loginUser({ id: user.id, name: user.name, member_id: user.member_id });
      } else {
        const users = loadLocal<RoomUser[]>(localUsersKey, []);
        const user = users.find(
          (item) =>
            item.name.toLowerCase() === name.toLowerCase() &&
            item.password_hash === passwordHash
        );

        if (!user) {
          setAuthStatus("Login failed. Check name and password.");
          return;
        }

        loginUser({ id: user.id, name: user.name, member_id: user.member_id });
      }

      setStatus(`Welcome back, ${name}.`);
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setIsSaving(false);
    }
  }

  function loginUser(user: SessionUser) {
    setCurrentUser(user);
    saveLocal(localSessionKey, user);
    setAuthName("");
    setAuthPassword("");
    setAuthCode("");
  }

  function logoutUser() {
    setCurrentUser(null);
    window.localStorage.removeItem(localSessionKey);
    setStatus("");
  }

  async function addMember() {
    const name = newMemberName.trim();
    if (!name) return;

    setIsSaving(true);
    setStatus("");

    try {
      if (supabase) {
        const { data, error } = await supabase.from("room_members").insert({ name }).select().single();
        if (error) throw error;
        setMembers((current) => [...current, data as Member]);
      } else {
        const nextMembers = [...members, { id: makeId(), name, created_at: new Date().toISOString() }];
        setMembers(nextMembers);
        saveLocal(localMembersKey, nextMembers);
      }

      setNewMemberName("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not add member.");
    } finally {
      setIsSaving(false);
    }
  }

  async function addExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedAmount = Number(amount);
    if (!payerId || selectedMemberIds.length === 0 || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setStatus("Choose payer, split members, and enter a valid amount.");
      return;
    }

    const expense: Expense = {
      id: makeId(),
      payer_id: payerId,
      amount: roundMoney(parsedAmount),
      note: note.trim(),
      participant_ids: selectedMemberIds,
      shares: makeShares(roundMoney(parsedAmount), selectedMemberIds),
      created_at: new Date().toISOString()
    };

    setIsSaving(true);
    setStatus("");

    try {
      if (supabase) {
        const { error } = await supabase.from("expenses").insert({
          payer_id: expense.payer_id,
          amount: expense.amount,
          note: expense.note,
          participant_ids: expense.participant_ids,
          shares: expense.shares
        });

        if (error) throw error;
        await loadData(false);
      } else {
        const nextExpenses = [expense, ...expenses];
        setExpenses(nextExpenses);
        saveLocal(localExpensesKey, nextExpenses);
      }

      setAmount("");
      setNote("");
      setStatus("Split saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save expense.");
    } finally {
      setIsSaving(false);
    }
  }

  async function recordPayment(settlement: Settlement) {
    if (currentUser?.member_id !== settlement.from) {
      setStatus(`${memberName(members, settlement.from)} must login to mark this payment.`);
      return;
    }

    const key = settlementKey(settlement);
    const parsedAmount = Number(paymentAmounts[key] ?? settlement.amount);
    const paymentAmount = roundMoney(parsedAmount);

    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      setStatus("Enter a valid payment amount.");
      return;
    }

    if (paymentAmount > settlement.amount + 0.01) {
      setStatus("Payment cannot be more than the remaining amount.");
      return;
    }

    const payment: Payment = {
      id: makeId(),
      from_id: settlement.from,
      to_id: settlement.to,
      amount: paymentAmount,
      status: "pending",
      verified_at: null,
      created_at: new Date().toISOString()
    };

    setIsSaving(true);
    setStatus("");

    try {
      if (supabase) {
        const { error } = await supabase.from("payments").insert({
          from_id: payment.from_id,
          to_id: payment.to_id,
          amount: payment.amount,
          status: payment.status
        });

        if (error) throw error;
        await loadData(false);
      } else {
        const nextPayments = [payment, ...payments];
        setPayments(nextPayments);
        saveLocal(localPaymentsKey, nextPayments);
      }

      setStatus("Payment marked as pending. Receiver must verify it.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not record payment.");
    } finally {
      setIsSaving(false);
    }
  }

  async function verifyPayment(payment: Payment) {
    if (currentUser?.member_id !== payment.to_id) {
      setStatus(`${memberName(members, payment.to_id)} must login to verify this payment.`);
      return;
    }

    const verifiedAt = new Date().toISOString();
    setIsSaving(true);
    setStatus("");

    try {
      if (supabase) {
        const { error } = await supabase
          .from("payments")
          .update({ status: "verified", verified_at: verifiedAt })
          .eq("id", payment.id);

        if (error) throw error;
        await loadData(false);
      } else {
        const nextPayments = payments.map((item) =>
          item.id === payment.id
            ? { ...item, status: "verified" as const, verified_at: verifiedAt }
            : item
        );
        setPayments(nextPayments);
        saveLocal(localPaymentsKey, nextPayments);
      }

      setStatus("Payment verified and balances updated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not verify payment.");
    } finally {
      setIsSaving(false);
    }
  }

  function toggleMember(memberId: string) {
    setSelectedMemberIds((current) => {
      if (current.includes(memberId)) return current.filter((id) => id !== memberId);
      return [...current, memberId];
    });
  }

  if (!currentUser) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <div>
            <p className="eyebrow">Room 301</p>
            <h1>Login to split and verify payments.</h1>
          </div>

          <form className="auth-form" onSubmit={handleAuth}>
            <div className="auth-tabs" aria-label="Authentication mode">
              <button
                className={authMode === "login" ? "active" : ""}
                type="button"
                onClick={() => setAuthMode("login")}
              >
                Login
              </button>
              <button
                className={authMode === "signup" ? "active" : ""}
                type="button"
                onClick={() => setAuthMode("signup")}
              >
                Create user
              </button>
            </div>

            <label>
              Name
              <input
                placeholder="Enter your name"
                value={authName}
                onChange={(event) => setAuthName(event.target.value)}
              />
            </label>

            <label>
              Password
              <input
                placeholder="Your password"
                type="password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
              />
            </label>

            {authMode === "signup" && (
              <label>
                Secret code
                <input
                  placeholder="Enter the Secretcode"
                  type="password"
                  value={authCode}
                  onChange={(event) => setAuthCode(event.target.value)}
                />
              </label>
            )}

            <button className="primary-button" disabled={isSaving} type="submit">
              {authMode === "login" ? "Login" : "Create user"}
            </button>

            {authStatus && <p className="status">{authStatus}</p>}
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Room Expense Splitter</p>
          <h1>Split shared room costs without losing track.</h1>
        </div>
        <div className="top-actions">
          <div className="sync-pill" title={isSupabaseConfigured ? "Supabase connected" : "Using local browser storage"}>
            <Database size={18} />
            {isSupabaseConfigured ? "Supabase" : "Local demo"}
          </div>
          <div className="user-pill" title="Logged in user">
            <Users size={18} />
            {currentUser.name}
          </div>
          <button className="logout-button" onClick={logoutUser} type="button">
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </section>

      <section className="summary-grid" aria-label="Summary">
        <div className="metric">
          <ReceiptText />
          <span>Total spent</span>
          <strong>{money.format(totalSpent)}</strong>
        </div>
        <div className="metric">
          <Users />
          <span>Members</span>
          <strong>{members.length}</strong>
        </div>
        <div className="metric">
          <CircleDollarSign />
          <span>Pending payments</span>
          <strong>{pendingPayments.length}</strong>
        </div>
      </section>

      <section className="workspace">
        <div className="panel primary-panel">
          <div className="panel-title">
            <Banknote size={22} />
            <h2>Add a split</h2>
          </div>

          <form onSubmit={addExpense} className="expense-form">
            <label>
              Paid by
              <select value={payerId} onChange={(event) => setPayerId(event.target.value)}>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Amount
              <input
                inputMode="decimal"
                min="0"
                placeholder="1200"
                type="number"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>

            <label className="full">
              Note
              <input
                placeholder="Rent, groceries, electricity..."
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>

            <div className="full">
              <div className="split-header">
                <span>Split with</span>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setSelectedMemberIds(members.map((member) => member.id))}
                >
                  Select all
                </button>
              </div>
              <div className="member-options">
                {members.map((member) => {
                  const isSelected = selectedMemberIds.includes(member.id);
                  return (
                    <button
                      className={isSelected ? "member-chip selected" : "member-chip"}
                      key={member.id}
                      type="button"
                      onClick={() => toggleMember(member.id)}
                    >
                      {isSelected && <Check size={16} />}
                      {member.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <button className="primary-button full" disabled={isSaving || isLoading} type="submit">
              <Plus size={18} />
              Save split
            </button>
          </form>

          {status && <p className="status">{status}</p>}
        </div>

        <aside className="panel">
          <div className="panel-title compact-title">
            <Users size={20} />
            <h2>Room members</h2>
          </div>
          <div className="add-member">
            <input
              placeholder="New member"
              value={newMemberName}
              onChange={(event) => setNewMemberName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void addMember();
              }}
            />
            <button aria-label="Add member" disabled={isSaving} onClick={addMember}>
              <Plus size={18} />
            </button>
          </div>
          <div className="member-list">
            {members.map((member) => (
              <div key={member.id} className="member-row">
                <span>{member.name}</span>
                <strong className={balances[member.id] >= 0 ? "positive" : "negative"}>
                  {money.format(balances[member.id] ?? 0)}
                </strong>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="panel pending-panel">
        <div className="panel-title compact-title">
          <ShieldCheck size={20} />
          <h2>Pending verification</h2>
        </div>
        <div className="pending-list">
          {pendingPayments.length === 0 ? (
            <p className="empty">No pending payments.</p>
          ) : (
            pendingPayments.map((payment) => (
              <article className="pending-row" key={payment.id}>
                <div>
                  <span>
                    {memberName(members, payment.from_id)} marked paid to{" "}
                    {memberName(members, payment.to_id)}
                  </span>
                  <strong>{money.format(payment.amount)}</strong>
                </div>
                <button
                  disabled={isSaving || currentUser.member_id !== payment.to_id}
                  onClick={() => void verifyPayment(payment)}
                  type="button"
                >
                  <ShieldCheck size={17} />
                  {memberName(members, payment.to_id)} verify
                </button>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="lower-grid">
        <div className="panel">
          <div className="panel-title compact-title">
            <RefreshCw size={20} />
            <h2>Who should pay whom</h2>
          </div>
          <div className="settlements">
            {settlements.length === 0 ? (
              <p className="empty">Everything is settled.</p>
            ) : (
              settlements.map((settlement, index) => (
                <div className="settlement-row" key={`${settlement.from}-${settlement.to}-${index}`}>
                  <div className="settlement-copy">
                    <span>
                      {memberName(members, settlement.from)} pays {memberName(members, settlement.to)}
                    </span>
                    <strong>{money.format(settlement.amount)}</strong>
                  </div>
                  <div className="payment-action">
                    <input
                      aria-label={`Payment amount from ${memberName(members, settlement.from)} to ${memberName(members, settlement.to)}`}
                      inputMode="decimal"
                      min="0"
                      type="number"
                      value={paymentAmounts[settlementKey(settlement)] ?? settlement.amount}
                      onChange={(event) =>
                        setPaymentAmounts((current) => ({
                          ...current,
                          [settlementKey(settlement)]: event.target.value
                        }))
                      }
                    />
                    <button
                      disabled={isSaving || currentUser.member_id !== settlement.from}
                      onClick={() => void recordPayment(settlement)}
                      type="button"
                    >
                      <HandCoins size={17} />
                      I paid
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel history-panel">
          <div className="panel-title compact-title">
            <ReceiptText size={20} />
            <h2>Saved splits</h2>
          </div>
          <div className="history-list">
            {expenses.length === 0 ? (
              <p className="empty">No splits saved yet.</p>
            ) : (
              expenses.map((expense) => (
                <article className="expense-item" key={expense.id}>
                  <div>
                    <strong>{expense.note || "Room expense"}</strong>
                    <span>
                      Paid by {memberName(members, expense.payer_id)} · split with{" "}
                      {expense.participant_ids.map((id) => memberName(members, id)).join(", ")}
                    </span>
                  </div>
                  <strong>{money.format(expense.amount)}</strong>
                </article>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
