import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type DB = SupabaseClient<Database>;

export class MeetingService {
  constructor(private db: DB) {}

  async createMeeting(input: {
    organizationId: string;
    missionId: string;
    zoneId: string | null;
    title: string;
    topic: string;
    maxRounds: number;
  }) {
    const { data, error } = await this.db
      .from("meetings")
      .insert({
        organization_id: input.organizationId,
        mission_id: input.missionId,
        zone_id: input.zoneId,
        title: input.title,
        topic: input.topic,
        status: "active",
        max_rounds: input.maxRounds,
        current_round: 0,
        started_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error) throw new Error(`MEETING_CREATE_FAILED: ${error.message}`);
    return data;
  }

  async inviteAgent(
    organizationId: string,
    meetingId: string,
    agentId: string,
    role = "participant",
  ) {
    const { error } = await this.db
      .from("meeting_participants")
      .upsert(
        { organization_id: organizationId, meeting_id: meetingId, agent_id: agentId, role },
        { onConflict: "meeting_id,agent_id" },
      );
    if (error) throw new Error(`MEETING_INVITE_FAILED: ${error.message}`);
  }

  async submitContribution(input: {
    organizationId: string;
    meetingId: string;
    agentId: string;
    round: number;
    content: string;
  }) {
    const { error } = await this.db.from("meeting_messages").insert({
      organization_id: input.organizationId,
      meeting_id: input.meetingId,
      agent_id: input.agentId,
      round: input.round,
      content: input.content,
    });
    if (error) throw new Error(`MEETING_CONTRIBUTION_FAILED: ${error.message}`);
  }

  async finishMeeting(meetingId: string, round: number, summary: string) {
    const { error } = await this.db
      .from("meetings")
      .update({
        status: "ended",
        current_round: round,
        ended_at: new Date().toISOString(),
        summary,
      })
      .eq("id", meetingId)
      .eq("status", "active");
    if (error) throw new Error(`MEETING_FINISH_FAILED: ${error.message}`);
  }
}
