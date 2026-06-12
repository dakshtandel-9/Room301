export type Member = {
  id: string;
  name: string;
  created_at?: string;
};

export type RoomUser = {
  id: string;
  name: string;
  member_id: string;
  password_hash: string;
  room_code: string;
  created_at?: string;
};

export type SessionUser = {
  id: string;
  name: string;
  member_id: string;
};

export type Expense = {
  id: string;
  payer_id: string;
  amount: number;
  note: string;
  participant_ids: string[];
  shares: Record<string, number>;
  created_at: string;
};

export type Payment = {
  id: string;
  from_id: string;
  to_id: string;
  amount: number;
  status: "pending" | "verified";
  verified_at?: string | null;
  created_at: string;
};

export type Settlement = {
  from: string;
  to: string;
  amount: number;
};
