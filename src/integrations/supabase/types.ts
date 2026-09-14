export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      agent_memories: {
        Row: {
          agent_id: string | null;
          content: string;
          created_at: string;
          id: string;
          importance: number;
          key: string | null;
          metadata: Json;
          mission_id: string | null;
          organization_id: string;
          scope: string;
        };
        Insert: {
          agent_id?: string | null;
          content: string;
          created_at?: string;
          id?: string;
          importance?: number;
          key?: string | null;
          metadata?: Json;
          mission_id?: string | null;
          organization_id: string;
          scope?: string;
        };
        Update: {
          agent_id?: string | null;
          content?: string;
          created_at?: string;
          id?: string;
          importance?: number;
          key?: string | null;
          metadata?: Json;
          mission_id?: string | null;
          organization_id?: string;
          scope?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_memories_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_memories_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_messages: {
        Row: {
          content: string;
          created_at: string;
          from_agent_id: string | null;
          from_user_id: string | null;
          id: string;
          kind: string;
          meeting_id: string | null;
          metadata: Json;
          mission_id: string | null;
          organization_id: string;
          to_agent_id: string | null;
        };
        Insert: {
          content: string;
          created_at?: string;
          from_agent_id?: string | null;
          from_user_id?: string | null;
          id?: string;
          kind?: string;
          meeting_id?: string | null;
          metadata?: Json;
          mission_id?: string | null;
          organization_id: string;
          to_agent_id?: string | null;
        };
        Update: {
          content?: string;
          created_at?: string;
          from_agent_id?: string | null;
          from_user_id?: string | null;
          id?: string;
          kind?: string;
          meeting_id?: string | null;
          metadata?: Json;
          mission_id?: string | null;
          organization_id?: string;
          to_agent_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "agent_messages_from_agent_id_fkey";
            columns: ["from_agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_messages_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_messages_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_messages_to_agent_id_fkey";
            columns: ["to_agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_permissions: {
        Row: {
          agent_id: string;
          always_allow: boolean;
          created_at: string;
          granted: boolean;
          granted_by: string | null;
          id: string;
          organization_id: string;
          permission: string;
        };
        Insert: {
          agent_id: string;
          always_allow?: boolean;
          created_at?: string;
          granted?: boolean;
          granted_by?: string | null;
          id?: string;
          organization_id: string;
          permission: string;
        };
        Update: {
          agent_id?: string;
          always_allow?: boolean;
          created_at?: string;
          granted?: boolean;
          granted_by?: string | null;
          id?: string;
          organization_id?: string;
          permission?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_permissions_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_permissions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_providers: {
        Row: {
          base_url: string | null;
          config: Json;
          created_at: string;
          has_api_key: boolean;
          headers: Json;
          health: Database["public"]["Enums"]["provider_health"];
          id: string;
          is_enabled: boolean;
          last_health_check_at: string | null;
          max_tokens: number;
          model: string | null;
          name: string;
          organization_id: string;
          temperature: number;
          timeout_ms: number;
          type: Database["public"]["Enums"]["provider_type"];
          updated_at: string;
        };
        Insert: {
          base_url?: string | null;
          config?: Json;
          created_at?: string;
          has_api_key?: boolean;
          headers?: Json;
          health?: Database["public"]["Enums"]["provider_health"];
          id?: string;
          is_enabled?: boolean;
          last_health_check_at?: string | null;
          max_tokens?: number;
          model?: string | null;
          name: string;
          organization_id: string;
          temperature?: number;
          timeout_ms?: number;
          type?: Database["public"]["Enums"]["provider_type"];
          updated_at?: string;
        };
        Update: {
          base_url?: string | null;
          config?: Json;
          created_at?: string;
          has_api_key?: boolean;
          headers?: Json;
          health?: Database["public"]["Enums"]["provider_health"];
          id?: string;
          is_enabled?: boolean;
          last_health_check_at?: string | null;
          max_tokens?: number;
          model?: string | null;
          name?: string;
          organization_id?: string;
          temperature?: number;
          timeout_ms?: number;
          type?: Database["public"]["Enums"]["provider_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_providers_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_runs: {
        Row: {
          agent_id: string | null;
          command_id: string | null;
          completed_at: string | null;
          cost: number;
          error: string | null;
          execution_mode: Database["public"]["Enums"]["execution_mode"];
          id: string;
          idempotency_key: string | null;
          is_simulated: boolean;
          latency_ms: number | null;
          mission_id: string | null;
          model: string | null;
          organization_id: string;
          provider_id: string | null;
          request_summary: string | null;
          response_summary: string | null;
          retries: number;
          started_at: string;
          status: string;
          task_id: string | null;
          tokens_in: number;
          tokens_out: number;
        };
        Insert: {
          agent_id?: string | null;
          command_id?: string | null;
          completed_at?: string | null;
          cost?: number;
          error?: string | null;
          execution_mode?: Database["public"]["Enums"]["execution_mode"];
          id?: string;
          idempotency_key?: string | null;
          is_simulated?: boolean;
          latency_ms?: number | null;
          mission_id?: string | null;
          model?: string | null;
          organization_id: string;
          provider_id?: string | null;
          request_summary?: string | null;
          response_summary?: string | null;
          retries?: number;
          started_at?: string;
          status?: string;
          task_id?: string | null;
          tokens_in?: number;
          tokens_out?: number;
        };
        Update: {
          agent_id?: string | null;
          command_id?: string | null;
          completed_at?: string | null;
          cost?: number;
          error?: string | null;
          execution_mode?: Database["public"]["Enums"]["execution_mode"];
          id?: string;
          idempotency_key?: string | null;
          is_simulated?: boolean;
          latency_ms?: number | null;
          mission_id?: string | null;
          model?: string | null;
          organization_id?: string;
          provider_id?: string | null;
          request_summary?: string | null;
          response_summary?: string | null;
          retries?: number;
          started_at?: string;
          status?: string;
          task_id?: string | null;
          tokens_in?: number;
          tokens_out?: number;
        };
        Relationships: [
          {
            foreignKeyName: "agent_runs_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_command_id_fkey";
            columns: ["command_id"];
            isOneToOne: false;
            referencedRelation: "commands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "agent_providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_runs_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_tools: {
        Row: {
          agent_id: string;
          config: Json;
          created_at: string;
          enabled: boolean;
          id: string;
          organization_id: string;
          tool_id: string;
        };
        Insert: {
          agent_id: string;
          config?: Json;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          organization_id: string;
          tool_id: string;
        };
        Update: {
          agent_id?: string;
          config?: Json;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          organization_id?: string;
          tool_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_tools_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_tools_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      agents: {
        Row: {
          animation_set_id: string;
          autonomy_level: number;
          capabilities: string[];
          character_sprite_id: string;
          color: string;
          context_limit: number;
          created_at: string;
          current_mission_id: string | null;
          current_task_id: string | null;
          department_id: string | null;
          description: string | null;
          external_config: Json;
          id: string;
          is_primary_controller: boolean;
          is_suspended: boolean;
          kind: Database["public"]["Enums"]["agent_kind"];
          manager_agent_id: string | null;
          max_cost: number;
          max_iterations: number;
          memory_enabled: boolean;
          model: string | null;
          name: string;
          organization_id: string;
          personality: string | null;
          position: Json | null;
          provider_id: string | null;
          require_approval: boolean;
          role: string;
          slug: string;
          sprite_set_id: string;
          status: Database["public"]["Enums"]["agent_status"];
          system_prompt: string | null;
          updated_at: string;
          workstation_id: string | null;
        };
        Insert: {
          animation_set_id?: string;
          autonomy_level?: number;
          capabilities?: string[];
          character_sprite_id?: string;
          color?: string;
          context_limit?: number;
          created_at?: string;
          current_mission_id?: string | null;
          current_task_id?: string | null;
          department_id?: string | null;
          description?: string | null;
          external_config?: Json;
          id?: string;
          is_primary_controller?: boolean;
          is_suspended?: boolean;
          kind?: Database["public"]["Enums"]["agent_kind"];
          manager_agent_id?: string | null;
          max_cost?: number;
          max_iterations?: number;
          memory_enabled?: boolean;
          model?: string | null;
          name: string;
          organization_id: string;
          personality?: string | null;
          position?: Json | null;
          provider_id?: string | null;
          require_approval?: boolean;
          role?: string;
          slug: string;
          sprite_set_id?: string;
          status?: Database["public"]["Enums"]["agent_status"];
          system_prompt?: string | null;
          updated_at?: string;
          workstation_id?: string | null;
        };
        Update: {
          animation_set_id?: string;
          autonomy_level?: number;
          capabilities?: string[];
          character_sprite_id?: string;
          color?: string;
          context_limit?: number;
          created_at?: string;
          current_mission_id?: string | null;
          current_task_id?: string | null;
          department_id?: string | null;
          description?: string | null;
          external_config?: Json;
          id?: string;
          is_primary_controller?: boolean;
          is_suspended?: boolean;
          kind?: Database["public"]["Enums"]["agent_kind"];
          manager_agent_id?: string | null;
          max_cost?: number;
          max_iterations?: number;
          memory_enabled?: boolean;
          model?: string | null;
          name?: string;
          organization_id?: string;
          personality?: string | null;
          position?: Json | null;
          provider_id?: string | null;
          require_approval?: boolean;
          role?: string;
          slug?: string;
          sprite_set_id?: string;
          status?: Database["public"]["Enums"]["agent_status"];
          system_prompt?: string | null;
          updated_at?: string;
          workstation_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "agents_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agents_manager_agent_id_fkey";
            columns: ["manager_agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agents_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agents_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "agent_providers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agents_workstation_id_fkey";
            columns: ["workstation_id"];
            isOneToOne: false;
            referencedRelation: "workstations";
            referencedColumns: ["id"];
          },
        ];
      };
      approval_requests: {
        Row: {
          action: string;
          agent_id: string | null;
          approval_scope: Database["public"]["Enums"]["approval_scope"];
          always_allow: boolean;
          created_at: string;
          id: string;
          kind: string;
          mission_id: string | null;
          organization_id: string;
          reason: string | null;
          requested_action: Json;
          required_permissions: string[];
          resolution_note: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          risk_level: Database["public"]["Enums"]["risk_level"];
          status: Database["public"]["Enums"]["approval_status"];
          task_id: string | null;
          tool_id: string | null;
        };
        Insert: {
          action: string;
          agent_id?: string | null;
          approval_scope?: Database["public"]["Enums"]["approval_scope"];
          always_allow?: boolean;
          created_at?: string;
          id?: string;
          kind?: string;
          mission_id?: string | null;
          organization_id: string;
          reason?: string | null;
          requested_action?: Json;
          required_permissions?: string[];
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          risk_level?: Database["public"]["Enums"]["risk_level"];
          status?: Database["public"]["Enums"]["approval_status"];
          task_id?: string | null;
          tool_id?: string | null;
        };
        Update: {
          action?: string;
          agent_id?: string | null;
          approval_scope?: Database["public"]["Enums"]["approval_scope"];
          always_allow?: boolean;
          created_at?: string;
          id?: string;
          kind?: string;
          mission_id?: string | null;
          organization_id?: string;
          reason?: string | null;
          requested_action?: Json;
          required_permissions?: string[];
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          risk_level?: Database["public"]["Enums"]["risk_level"];
          status?: Database["public"]["Enums"]["approval_status"];
          task_id?: string | null;
          tool_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "approval_requests_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approval_requests_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approval_requests_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approval_requests_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_user_id: string | null;
          agent_id: string | null;
          approved_by: string | null;
          created_at: string;
          id: string;
          input_summary: string | null;
          metadata: Json;
          mission_id: string | null;
          organization_id: string;
          output_summary: string | null;
          risk_level: Database["public"]["Enums"]["risk_level"];
          task_id: string | null;
          tool: string | null;
        };
        Insert: {
          action: string;
          actor_user_id?: string | null;
          agent_id?: string | null;
          approved_by?: string | null;
          created_at?: string;
          id?: string;
          input_summary?: string | null;
          metadata?: Json;
          mission_id?: string | null;
          organization_id: string;
          output_summary?: string | null;
          risk_level?: Database["public"]["Enums"]["risk_level"];
          task_id?: string | null;
          tool?: string | null;
        };
        Update: {
          action?: string;
          actor_user_id?: string | null;
          agent_id?: string | null;
          approved_by?: string | null;
          created_at?: string;
          id?: string;
          input_summary?: string | null;
          metadata?: Json;
          mission_id?: string | null;
          organization_id?: string;
          output_summary?: string | null;
          risk_level?: Database["public"]["Enums"]["risk_level"];
          task_id?: string | null;
          tool?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      command_results: {
        Row: {
          agent_id: string | null;
          command_id: string;
          cost: number;
          created_at: string;
          evidence: Json;
          id: string;
          latency_ms: number | null;
          organization_id: string;
          output: Json;
          status: Database["public"]["Enums"]["command_status"];
          summary: string | null;
          tokens_in: number;
          tokens_out: number;
        };
        Insert: {
          agent_id?: string | null;
          command_id: string;
          cost?: number;
          created_at?: string;
          evidence?: Json;
          id?: string;
          latency_ms?: number | null;
          organization_id: string;
          output?: Json;
          status: Database["public"]["Enums"]["command_status"];
          summary?: string | null;
          tokens_in?: number;
          tokens_out?: number;
        };
        Update: {
          agent_id?: string | null;
          command_id?: string;
          cost?: number;
          created_at?: string;
          evidence?: Json;
          id?: string;
          latency_ms?: number | null;
          organization_id?: string;
          output?: Json;
          status?: Database["public"]["Enums"]["command_status"];
          summary?: string | null;
          tokens_in?: number;
          tokens_out?: number;
        };
        Relationships: [
          {
            foreignKeyName: "command_results_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "command_results_command_id_fkey";
            columns: ["command_id"];
            isOneToOne: false;
            referencedRelation: "commands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "command_results_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      commands: {
        Row: {
          allowed_tools: string[];
          assigned_to_agent_id: string | null;
          completed_at: string | null;
          constraints: Json;
          context: Json;
          created_at: string;
          deadline: string | null;
          expected_output: string | null;
          execution_mode: Database["public"]["Enums"]["execution_mode"];
          forbidden_actions: string[];
          id: string;
          idempotency_key: string | null;
          instructions: string;
          issued_by_agent_id: string | null;
          max_cost: number;
          max_iterations: number;
          mission_id: string;
          objective: string;
          organization_id: string;
          parent_command_id: string | null;
          started_at: string | null;
          status: Database["public"]["Enums"]["command_status"];
          task_id: string | null;
        };
        Insert: {
          allowed_tools?: string[];
          assigned_to_agent_id?: string | null;
          completed_at?: string | null;
          constraints?: Json;
          context?: Json;
          created_at?: string;
          deadline?: string | null;
          expected_output?: string | null;
          execution_mode?: Database["public"]["Enums"]["execution_mode"];
          forbidden_actions?: string[];
          id?: string;
          idempotency_key?: string | null;
          instructions: string;
          issued_by_agent_id?: string | null;
          max_cost?: number;
          max_iterations?: number;
          mission_id: string;
          objective: string;
          organization_id: string;
          parent_command_id?: string | null;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["command_status"];
          task_id?: string | null;
        };
        Update: {
          allowed_tools?: string[];
          assigned_to_agent_id?: string | null;
          completed_at?: string | null;
          constraints?: Json;
          context?: Json;
          created_at?: string;
          deadline?: string | null;
          expected_output?: string | null;
          execution_mode?: Database["public"]["Enums"]["execution_mode"];
          forbidden_actions?: string[];
          id?: string;
          idempotency_key?: string | null;
          instructions?: string;
          issued_by_agent_id?: string | null;
          max_cost?: number;
          max_iterations?: number;
          mission_id?: string;
          objective?: string;
          organization_id?: string;
          parent_command_id?: string | null;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["command_status"];
          task_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "commands_assigned_to_agent_id_fkey";
            columns: ["assigned_to_agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commands_issued_by_agent_id_fkey";
            columns: ["issued_by_agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commands_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commands_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commands_parent_command_id_fkey";
            columns: ["parent_command_id"];
            isOneToOne: false;
            referencedRelation: "commands";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commands_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      cost_records: {
        Row: {
          agent_id: string | null;
          created_at: string;
          estimated_cost: number;
          id: string;
          input_tokens: number;
          is_simulated: boolean;
          mission_id: string | null;
          model: string | null;
          organization_id: string;
          output_tokens: number;
          provider_id: string | null;
          provider_type: string | null;
          task_id: string | null;
        };
        Insert: {
          agent_id?: string | null;
          created_at?: string;
          estimated_cost?: number;
          id?: string;
          input_tokens?: number;
          is_simulated?: boolean;
          mission_id?: string | null;
          model?: string | null;
          organization_id: string;
          output_tokens?: number;
          provider_id?: string | null;
          provider_type?: string | null;
          task_id?: string | null;
        };
        Update: {
          agent_id?: string | null;
          created_at?: string;
          estimated_cost?: number;
          id?: string;
          input_tokens?: number;
          is_simulated?: boolean;
          mission_id?: string | null;
          model?: string | null;
          organization_id?: string;
          output_tokens?: number;
          provider_id?: string | null;
          provider_type?: string | null;
          task_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "cost_records_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cost_records_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cost_records_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cost_records_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: false;
            referencedRelation: "agent_providers";
            referencedColumns: ["id"];
          },
        ];
      };
      departments: {
        Row: {
          color: string;
          context: string | null;
          created_at: string;
          description: string | null;
          id: string;
          manager_agent_id: string | null;
          name: string;
          organization_id: string;
          policies: Json;
          slug: string;
          sort_order: number;
          tools: Json;
        };
        Insert: {
          color?: string;
          context?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          manager_agent_id?: string | null;
          name: string;
          organization_id: string;
          policies?: Json;
          slug: string;
          sort_order?: number;
          tools?: Json;
        };
        Update: {
          color?: string;
          context?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          manager_agent_id?: string | null;
          name?: string;
          organization_id?: string;
          policies?: Json;
          slug?: string;
          sort_order?: number;
          tools?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "departments_manager_fk";
            columns: ["manager_agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "departments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      meeting_messages: {
        Row: {
          agent_id: string | null;
          content: string;
          created_at: string;
          id: string;
          meeting_id: string;
          organization_id: string;
          round: number;
        };
        Insert: {
          agent_id?: string | null;
          content: string;
          created_at?: string;
          id?: string;
          meeting_id: string;
          organization_id: string;
          round?: number;
        };
        Update: {
          agent_id?: string | null;
          content?: string;
          created_at?: string;
          id?: string;
          meeting_id?: string;
          organization_id?: string;
          round?: number;
        };
        Relationships: [
          {
            foreignKeyName: "meeting_messages_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "meeting_messages_meeting_id_fkey";
            columns: ["meeting_id"];
            isOneToOne: false;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "meeting_messages_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      meeting_participants: {
        Row: {
          agent_id: string;
          id: string;
          meeting_id: string;
          organization_id: string;
          role: string;
        };
        Insert: {
          agent_id: string;
          id?: string;
          meeting_id: string;
          organization_id: string;
          role?: string;
        };
        Update: {
          agent_id?: string;
          id?: string;
          meeting_id?: string;
          organization_id?: string;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: "meeting_participants_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "meeting_participants_meeting_id_fkey";
            columns: ["meeting_id"];
            isOneToOne: false;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "meeting_participants_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      meetings: {
        Row: {
          created_at: string;
          current_round: number;
          ended_at: string | null;
          id: string;
          max_rounds: number;
          mission_id: string | null;
          organization_id: string;
          started_at: string | null;
          status: string;
          summary: string | null;
          title: string;
          topic: string | null;
          zone_id: string | null;
        };
        Insert: {
          created_at?: string;
          current_round?: number;
          ended_at?: string | null;
          id?: string;
          max_rounds?: number;
          mission_id?: string | null;
          organization_id: string;
          started_at?: string | null;
          status?: string;
          summary?: string | null;
          title: string;
          topic?: string | null;
          zone_id?: string | null;
        };
        Update: {
          created_at?: string;
          current_round?: number;
          ended_at?: string | null;
          id?: string;
          max_rounds?: number;
          mission_id?: string | null;
          organization_id?: string;
          started_at?: string | null;
          status?: string;
          summary?: string | null;
          title?: string;
          topic?: string | null;
          zone_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "meetings_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "meetings_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "meetings_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "office_zones";
            referencedColumns: ["id"];
          },
        ];
      };
      mission_agents: {
        Row: {
          agent_id: string;
          id: string;
          mission_id: string;
          organization_id: string;
          role_in_mission: string;
        };
        Insert: {
          agent_id: string;
          id?: string;
          mission_id: string;
          organization_id: string;
          role_in_mission?: string;
        };
        Update: {
          agent_id?: string;
          id?: string;
          mission_id?: string;
          organization_id?: string;
          role_in_mission?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mission_agents_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mission_agents_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mission_agents_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      mission_permissions: {
        Row: {
          agent_id: string;
          created_at: string;
          granted_by: string | null;
          id: string;
          mission_id: string;
          organization_id: string;
          permission: string;
        };
        Insert: {
          agent_id: string;
          created_at?: string;
          granted_by?: string | null;
          id?: string;
          mission_id: string;
          organization_id: string;
          permission: string;
        };
        Update: {
          agent_id?: string;
          created_at?: string;
          granted_by?: string | null;
          id?: string;
          mission_id?: string;
          organization_id?: string;
          permission?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mission_permissions_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mission_permissions_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mission_permissions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      mission_events: {
        Row: {
          agent_id: string | null;
          created_at: string;
          id: string;
          message: string;
          mission_id: string | null;
          organization_id: string;
          payload: Json;
          target_agent_id: string | null;
          task_id: string | null;
          type: string;
        };
        Insert: {
          agent_id?: string | null;
          created_at?: string;
          id?: string;
          message: string;
          mission_id?: string | null;
          organization_id: string;
          payload?: Json;
          target_agent_id?: string | null;
          task_id?: string | null;
          type: string;
        };
        Update: {
          agent_id?: string | null;
          created_at?: string;
          id?: string;
          message?: string;
          mission_id?: string | null;
          organization_id?: string;
          payload?: Json;
          target_agent_id?: string | null;
          task_id?: string | null;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mission_events_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mission_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      missions: {
        Row: {
          allowed_agent_ids: string[];
          approval_policy: string;
          budget: number;
          commander_agent_id: string | null;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          current_step: number;
          error: string | null;
          execution_mode: Database["public"]["Enums"]["execution_mode"];
          goal: string;
          id: string;
          is_simulated: boolean;
          max_steps: number;
          organization_id: string;
          phase: string;
          report: Json | null;
          result: string | null;
          started_at: string | null;
          step_lock_id: string | null;
          step_locked_until: string | null;
          status: Database["public"]["Enums"]["mission_status"];
          stop_requested: boolean;
          summary: string | null;
          title: string;
          total_cost: number;
          total_tokens_in: number;
          total_tokens_out: number;
          updated_at: string;
        };
        Insert: {
          allowed_agent_ids?: string[];
          approval_policy?: string;
          budget?: number;
          commander_agent_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_step?: number;
          error?: string | null;
          execution_mode?: Database["public"]["Enums"]["execution_mode"];
          goal: string;
          id?: string;
          is_simulated?: boolean;
          max_steps?: number;
          organization_id: string;
          phase?: string;
          report?: Json | null;
          result?: string | null;
          started_at?: string | null;
          step_lock_id?: string | null;
          step_locked_until?: string | null;
          status?: Database["public"]["Enums"]["mission_status"];
          stop_requested?: boolean;
          summary?: string | null;
          title: string;
          total_cost?: number;
          total_tokens_in?: number;
          total_tokens_out?: number;
          updated_at?: string;
        };
        Update: {
          allowed_agent_ids?: string[];
          approval_policy?: string;
          budget?: number;
          commander_agent_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_step?: number;
          error?: string | null;
          execution_mode?: Database["public"]["Enums"]["execution_mode"];
          goal?: string;
          id?: string;
          is_simulated?: boolean;
          max_steps?: number;
          organization_id?: string;
          phase?: string;
          report?: Json | null;
          result?: string | null;
          started_at?: string | null;
          step_lock_id?: string | null;
          step_locked_until?: string | null;
          status?: Database["public"]["Enums"]["mission_status"];
          stop_requested?: boolean;
          summary?: string | null;
          title?: string;
          total_cost?: number;
          total_tokens_in?: number;
          total_tokens_out?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "missions_commander_agent_id_fkey";
            columns: ["commander_agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "missions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      office_maps: {
        Row: {
          created_at: string;
          height: number;
          id: string;
          is_default: boolean;
          layers: Json;
          name: string;
          organization_id: string;
          tile_size: number;
          updated_at: string;
          width: number;
        };
        Insert: {
          created_at?: string;
          height?: number;
          id?: string;
          is_default?: boolean;
          layers?: Json;
          name?: string;
          organization_id: string;
          tile_size?: number;
          updated_at?: string;
          width?: number;
        };
        Update: {
          created_at?: string;
          height?: number;
          id?: string;
          is_default?: boolean;
          layers?: Json;
          name?: string;
          organization_id?: string;
          tile_size?: number;
          updated_at?: string;
          width?: number;
        };
        Relationships: [
          {
            foreignKeyName: "office_maps_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      office_zones: {
        Row: {
          color: string | null;
          created_at: string;
          department_id: string | null;
          height: number;
          id: string;
          kind: string;
          name: string;
          office_map_id: string;
          organization_id: string;
          properties: Json;
          width: number;
          x: number;
          y: number;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          department_id?: string | null;
          height: number;
          id?: string;
          kind: string;
          name: string;
          office_map_id: string;
          organization_id: string;
          properties?: Json;
          width: number;
          x: number;
          y: number;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          department_id?: string | null;
          height?: number;
          id?: string;
          kind?: string;
          name?: string;
          office_map_id?: string;
          organization_id?: string;
          properties?: Json;
          width?: number;
          x?: number;
          y?: number;
        };
        Relationships: [
          {
            foreignKeyName: "office_zones_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "office_zones_office_map_id_fkey";
            columns: ["office_map_id"];
            isOneToOne: false;
            referencedRelation: "office_maps";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "office_zones_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_members: {
        Row: {
          created_at: string;
          id: string;
          organization_id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          organization_id: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_settings: {
        Row: {
          daily_cost_limit: number | null;
          default_timeout_seconds: number;
          max_agent_calls: number;
          max_delegation_depth: number;
          max_meeting_rounds: number;
          max_mission_cost: number;
          max_steps: number;
          monthly_cost_limit: number | null;
          organization_id: string;
          policies: Json;
          require_approval_for: string[];
          updated_at: string;
        };
        Insert: {
          daily_cost_limit?: number | null;
          default_timeout_seconds?: number;
          max_agent_calls?: number;
          max_delegation_depth?: number;
          max_meeting_rounds?: number;
          max_mission_cost?: number;
          max_steps?: number;
          monthly_cost_limit?: number | null;
          organization_id: string;
          policies?: Json;
          require_approval_for?: string[];
          updated_at?: string;
        };
        Update: {
          daily_cost_limit?: number | null;
          default_timeout_seconds?: number;
          max_agent_calls?: number;
          max_delegation_depth?: number;
          max_meeting_rounds?: number;
          max_mission_cost?: number;
          max_steps?: number;
          monthly_cost_limit?: number | null;
          organization_id?: string;
          policies?: Json;
          require_approval_for?: string[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          asset_mode: string;
          created_at: string;
          id: string;
          kill_switch_active: boolean;
          name: string;
          owner_id: string;
          settings: Json;
          simulation_mode: boolean;
          slug: string;
          updated_at: string;
        };
        Insert: {
          asset_mode?: string;
          created_at?: string;
          id?: string;
          kill_switch_active?: boolean;
          name: string;
          owner_id: string;
          settings?: Json;
          simulation_mode?: boolean;
          slug: string;
          updated_at?: string;
        };
        Update: {
          asset_mode?: string;
          created_at?: string;
          id?: string;
          kill_switch_active?: boolean;
          name?: string;
          owner_id?: string;
          settings?: Json;
          simulation_mode?: boolean;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          email: string | null;
          id: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          email?: string | null;
          id?: string;
        };
        Relationships: [];
      };
      provider_secrets: {
        Row: {
          api_key: string | null;
          bearer_token: string | null;
          organization_id: string;
          provider_id: string;
          secret_headers: Json;
          updated_at: string;
        };
        Insert: {
          api_key?: string | null;
          bearer_token?: string | null;
          organization_id: string;
          provider_id: string;
          secret_headers?: Json;
          updated_at?: string;
        };
        Update: {
          api_key?: string | null;
          bearer_token?: string | null;
          organization_id?: string;
          provider_id?: string;
          secret_headers?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provider_secrets_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provider_secrets_provider_id_fkey";
            columns: ["provider_id"];
            isOneToOne: true;
            referencedRelation: "agent_providers";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          assigned_agent_id: string | null;
          claimed_at: string | null;
          claimed_by_run_id: string | null;
          code: string;
          completed_at: string | null;
          cost: number;
          created_at: string;
          created_by_agent_id: string | null;
          depends_on: string[];
          description: string | null;
          evidence: Json;
          id: string;
          max_retries: number;
          mission_id: string;
          order_index: number;
          organization_id: string;
          parent_task_id: string | null;
          priority: number;
          result: string | null;
          retries: number;
          started_at: string | null;
          status: Database["public"]["Enums"]["task_status"];
          title: string;
          tokens_in: number;
          tokens_out: number;
          updated_at: string;
        };
        Insert: {
          assigned_agent_id?: string | null;
          claimed_at?: string | null;
          claimed_by_run_id?: string | null;
          code: string;
          completed_at?: string | null;
          cost?: number;
          created_at?: string;
          created_by_agent_id?: string | null;
          depends_on?: string[];
          description?: string | null;
          evidence?: Json;
          id?: string;
          max_retries?: number;
          mission_id: string;
          order_index?: number;
          organization_id: string;
          parent_task_id?: string | null;
          priority?: number;
          result?: string | null;
          retries?: number;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["task_status"];
          title: string;
          tokens_in?: number;
          tokens_out?: number;
          updated_at?: string;
        };
        Update: {
          assigned_agent_id?: string | null;
          claimed_at?: string | null;
          claimed_by_run_id?: string | null;
          code?: string;
          completed_at?: string | null;
          cost?: number;
          created_at?: string;
          created_by_agent_id?: string | null;
          depends_on?: string[];
          description?: string | null;
          evidence?: Json;
          id?: string;
          max_retries?: number;
          mission_id?: string;
          order_index?: number;
          organization_id?: string;
          parent_task_id?: string | null;
          priority?: number;
          result?: string | null;
          retries?: number;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["task_status"];
          title?: string;
          tokens_in?: number;
          tokens_out?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_agent_id_fkey";
            columns: ["assigned_agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_created_by_agent_id_fkey";
            columns: ["created_by_agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey";
            columns: ["parent_task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      tool_calls: {
        Row: {
          agent_id: string | null;
          agent_run_id: string | null;
          approval_request_id: string | null;
          created_at: string;
          execution_mode: Database["public"]["Enums"]["execution_mode"];
          id: string;
          idempotency_key: string | null;
          input_summary: string | null;
          latency_ms: number | null;
          mission_id: string | null;
          organization_id: string;
          output_summary: string | null;
          risk_level: Database["public"]["Enums"]["risk_level"];
          status: string;
          task_id: string | null;
          tool_id: string;
        };
        Insert: {
          agent_id?: string | null;
          agent_run_id?: string | null;
          approval_request_id?: string | null;
          created_at?: string;
          execution_mode?: Database["public"]["Enums"]["execution_mode"];
          id?: string;
          idempotency_key?: string | null;
          input_summary?: string | null;
          latency_ms?: number | null;
          mission_id?: string | null;
          organization_id: string;
          output_summary?: string | null;
          risk_level?: Database["public"]["Enums"]["risk_level"];
          status?: string;
          task_id?: string | null;
          tool_id: string;
        };
        Update: {
          agent_id?: string | null;
          agent_run_id?: string | null;
          approval_request_id?: string | null;
          created_at?: string;
          execution_mode?: Database["public"]["Enums"]["execution_mode"];
          id?: string;
          idempotency_key?: string | null;
          input_summary?: string | null;
          latency_ms?: number | null;
          mission_id?: string | null;
          organization_id?: string;
          output_summary?: string | null;
          risk_level?: Database["public"]["Enums"]["risk_level"];
          status?: string;
          task_id?: string | null;
          tool_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tool_calls_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tool_calls_agent_run_id_fkey";
            columns: ["agent_run_id"];
            isOneToOne: false;
            referencedRelation: "agent_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tool_calls_approval_request_id_fkey";
            columns: ["approval_request_id"];
            isOneToOne: false;
            referencedRelation: "approval_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tool_calls_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tool_calls_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tool_calls_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      workstations: {
        Row: {
          assigned_agent_id: string | null;
          created_at: string;
          department_id: string | null;
          desk_kind: string;
          facing: string;
          has_computer: boolean;
          id: string;
          name: string;
          office_map_id: string;
          organization_id: string;
          properties: Json;
          seat_x: number;
          seat_y: number;
          status: string;
          x: number;
          y: number;
          zone_id: string | null;
        };
        Insert: {
          assigned_agent_id?: string | null;
          created_at?: string;
          department_id?: string | null;
          desk_kind?: string;
          facing?: string;
          has_computer?: boolean;
          id?: string;
          name: string;
          office_map_id: string;
          organization_id: string;
          properties?: Json;
          seat_x: number;
          seat_y: number;
          status?: string;
          x: number;
          y: number;
          zone_id?: string | null;
        };
        Update: {
          assigned_agent_id?: string | null;
          created_at?: string;
          department_id?: string | null;
          desk_kind?: string;
          facing?: string;
          has_computer?: boolean;
          id?: string;
          name?: string;
          office_map_id?: string;
          organization_id?: string;
          properties?: Json;
          seat_x?: number;
          seat_y?: number;
          status?: string;
          x?: number;
          y?: number;
          zone_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "workstations_agent_fk";
            columns: ["assigned_agent_id"];
            isOneToOne: false;
            referencedRelation: "agents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workstations_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workstations_office_map_id_fkey";
            columns: ["office_map_id"];
            isOneToOne: false;
            referencedRelation: "office_maps";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workstations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workstations_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "office_zones";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_mission_step: {
        Args: { p_lease_seconds?: number; p_mission_id: string; p_worker_id: string };
        Returns: Database["public"]["Tables"]["missions"]["Row"];
      };
      release_mission_step: {
        Args: { p_mission_id: string; p_worker_id: string };
        Returns: boolean;
      };
      create_organization: {
        Args: { p_name: string; p_seed_demo?: boolean };
        Returns: string;
      };
      has_org_role: {
        Args: { _org: string; _role: Database["public"]["Enums"]["app_role"] };
        Returns: boolean;
      };
      is_org_member: { Args: { _org: string }; Returns: boolean };
    };
    Enums: {
      agent_kind: "llm" | "external" | "controller";
      agent_status:
        | "IDLE"
        | "WALKING"
        | "THINKING"
        | "WORKING"
        | "WAITING"
        | "DELEGATING"
        | "REVIEWING"
        | "MEETING"
        | "NEEDS_APPROVAL"
        | "ERROR"
        | "OFFLINE"
        | "PAUSED";
      app_role: "owner" | "admin" | "member";
      approval_status: "PENDING" | "APPROVED" | "DENIED" | "MODIFIED" | "EXPIRED";
      approval_scope: "ONCE" | "MISSION" | "PERSISTENT";
      command_status:
        | "PENDING"
        | "ACCEPTED"
        | "RUNNING"
        | "COMPLETED"
        | "FAILED"
        | "BLOCKED"
        | "NEEDS_CLARIFICATION"
        | "REQUEST_PERMISSION"
        | "REQUEST_SCOPE_EXTENSION"
        | "CANCELLED";
      execution_mode: "SIMULATION" | "REAL";
      mission_status:
        | "DRAFT"
        | "PLANNING"
        | "RUNNING"
        | "WAITING_APPROVAL"
        | "REVIEWING"
        | "COMPLETED"
        | "FAILED"
        | "STOPPED";
      provider_health:
        | "UNKNOWN"
        | "CONNECTED"
        | "DEGRADED"
        | "UNCONFIGURED"
        | "ERROR"
        | "FAILED"
        | "TIMEOUT"
        | "UNAUTHORIZED"
        | "OFFLINE"
        | "DISABLED";
      provider_type:
        | "simulation"
        | "lovable_ai"
        | "openai"
        | "anthropic"
        | "gemini"
        | "openrouter"
        | "ollama"
        | "custom";
      risk_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      task_status:
        "queued" | "running" | "completed" | "failed" | "waiting" | "blocked" | "cancelled";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      agent_kind: ["llm", "external", "controller"],
      agent_status: [
        "IDLE",
        "WALKING",
        "THINKING",
        "WORKING",
        "WAITING",
        "DELEGATING",
        "REVIEWING",
        "MEETING",
        "NEEDS_APPROVAL",
        "ERROR",
        "OFFLINE",
        "PAUSED",
      ],
      app_role: ["owner", "admin", "member"],
      approval_scope: ["ONCE", "MISSION", "PERSISTENT"],
      approval_status: ["PENDING", "APPROVED", "DENIED", "MODIFIED", "EXPIRED"],
      command_status: [
        "PENDING",
        "ACCEPTED",
        "RUNNING",
        "COMPLETED",
        "FAILED",
        "BLOCKED",
        "NEEDS_CLARIFICATION",
        "REQUEST_PERMISSION",
        "REQUEST_SCOPE_EXTENSION",
        "CANCELLED",
      ],
      execution_mode: ["SIMULATION", "REAL"],
      mission_status: [
        "DRAFT",
        "PLANNING",
        "RUNNING",
        "WAITING_APPROVAL",
        "REVIEWING",
        "COMPLETED",
        "FAILED",
        "STOPPED",
      ],
      provider_health: [
        "UNKNOWN",
        "CONNECTED",
        "DEGRADED",
        "UNCONFIGURED",
        "ERROR",
        "FAILED",
        "TIMEOUT",
        "UNAUTHORIZED",
        "OFFLINE",
        "DISABLED",
      ],
      provider_type: [
        "simulation",
        "lovable_ai",
        "openai",
        "anthropic",
        "gemini",
        "openrouter",
        "ollama",
        "custom",
      ],
      risk_level: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      task_status: ["queued", "running", "completed", "failed", "waiting", "blocked", "cancelled"],
    },
  },
} as const;
