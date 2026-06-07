/** A paid, public message as read from the `messages` table. */
export interface PitMessage {
  id: string;
  name: string;
  message: string;
  amount_cents: number;
  created_at: string;
  paid_at: string | null;
}

/** The columns the feed selects / receives over realtime. */
export const MESSAGE_COLUMNS =
  'id,name,message,amount_cents,created_at,paid_at';
