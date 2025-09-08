// types.ts
export interface ChannelData {
  id: string;
  name: string;
  votesYes: number;
  votesNo: number;
  verificationStatus: 0 | 1 | 2; // 0 = not verified, 1 = owned by PE, 2 = not owned by PE
}

export interface VoteRequest {
  channelId: string;
  vote: "yes" | "no";
}

export interface VerifyRequest {
  channelId: string;
  status: 0 | 1 | 2;
}