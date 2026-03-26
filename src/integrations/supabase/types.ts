export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action_type: string
          actor_id: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          created_at: string
          details: Json | null
          id: string
          request_id: string | null
        }
        Insert: {
          action_type: string
          actor_id?: string | null
          actor_type: Database["public"]["Enums"]["actor_type"]
          created_at?: string
          details?: Json | null
          id?: string
          request_id?: string | null
        }
        Update: {
          action_type?: string
          actor_id?: string | null
          actor_type?: Database["public"]["Enums"]["actor_type"]
          created_at?: string
          details?: Json | null
          id?: string
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "time_off_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_sync_logs: {
        Row: {
          action_type: Database["public"]["Enums"]["calendar_action_type"]
          created_at: string
          error_message: string | null
          google_calendar_event_id: string | null
          id: string
          request_id: string
          status: string | null
        }
        Insert: {
          action_type: Database["public"]["Enums"]["calendar_action_type"]
          created_at?: string
          error_message?: string | null
          google_calendar_event_id?: string | null
          id?: string
          request_id: string
          status?: string | null
        }
        Update: {
          action_type?: Database["public"]["Enums"]["calendar_action_type"]
          created_at?: string
          error_message?: string | null
          google_calendar_event_id?: string | null
          id?: string
          request_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_sync_logs_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "time_off_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          department: string | null
          email: string
          full_name: string
          id: string
          slack_user_id: string | null
          status: Database["public"]["Enums"]["user_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          department?: string | null
          email: string
          full_name: string
          id: string
          slack_user_id?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          department?: string | null
          email?: string
          full_name?: string
          id?: string
          slack_user_id?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          updated_at?: string
        }
        Relationships: []
      }
      slack_message_tracking: {
        Row: {
          created_at: string
          current_state: Database["public"]["Enums"]["slack_message_state"]
          id: string
          message_type: Database["public"]["Enums"]["slack_message_type"]
          request_id: string
          slack_channel_or_dm_id: string | null
          slack_message_ts: string | null
          slack_recipient_user_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_state?: Database["public"]["Enums"]["slack_message_state"]
          id?: string
          message_type: Database["public"]["Enums"]["slack_message_type"]
          request_id: string
          slack_channel_or_dm_id?: string | null
          slack_message_ts?: string | null
          slack_recipient_user_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_state?: Database["public"]["Enums"]["slack_message_state"]
          id?: string
          message_type?: Database["public"]["Enums"]["slack_message_type"]
          request_id?: string
          slack_channel_or_dm_id?: string | null
          slack_message_ts?: string | null
          slack_recipient_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "slack_message_tracking_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "time_off_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      time_off_requests: {
        Row: {
          approval_source: Database["public"]["Enums"]["approval_source"] | null
          approved_at: string | null
          approved_by_user_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by_user_id: string | null
          created_at: string
          day_portion: Database["public"]["Enums"]["day_portion"]
          employee_id: string
          end_date: string | null
          end_day_portion: Database["public"]["Enums"]["day_portion"]
          google_calendar_event_id: string | null
          id: string
          last_edited_at: string | null
          last_edited_by_user_id: string | null
          note: string | null
          rejected_at: string | null
          rejected_by_user_id: string | null
          rejection_reason: string | null
          request_type: Database["public"]["Enums"]["request_type"]
          sick_date: string | null
          start_date: string | null
          start_day_portion: Database["public"]["Enums"]["day_portion"]
          status: Database["public"]["Enums"]["request_status"]
          submitted_at: string
          updated_at: string
        }
        Insert: {
          approval_source?:
            | Database["public"]["Enums"]["approval_source"]
            | null
          approved_at?: string | null
          approved_by_user_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          created_at?: string
          day_portion?: Database["public"]["Enums"]["day_portion"]
          employee_id: string
          end_date?: string | null
          end_day_portion?: Database["public"]["Enums"]["day_portion"]
          google_calendar_event_id?: string | null
          id?: string
          last_edited_at?: string | null
          last_edited_by_user_id?: string | null
          note?: string | null
          rejected_at?: string | null
          rejected_by_user_id?: string | null
          rejection_reason?: string | null
          request_type: Database["public"]["Enums"]["request_type"]
          sick_date?: string | null
          start_date?: string | null
          start_day_portion?: Database["public"]["Enums"]["day_portion"]
          status?: Database["public"]["Enums"]["request_status"]
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          approval_source?:
            | Database["public"]["Enums"]["approval_source"]
            | null
          approved_at?: string | null
          approved_by_user_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          created_at?: string
          day_portion?: Database["public"]["Enums"]["day_portion"]
          employee_id?: string
          end_date?: string | null
          end_day_portion?: Database["public"]["Enums"]["day_portion"]
          google_calendar_event_id?: string | null
          id?: string
          last_edited_at?: string | null
          last_edited_by_user_id?: string | null
          note?: string | null
          rejected_at?: string | null
          rejected_by_user_id?: string | null
          rejection_reason?: string | null
          request_type?: Database["public"]["Enums"]["request_type"]
          sick_date?: string | null
          start_date?: string | null
          start_day_portion?: Database["public"]["Enums"]["day_portion"]
          status?: Database["public"]["Enums"]["request_status"]
          submitted_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vacation_policy: {
        Row: {
          active_flag: boolean
          created_at: string
          id: string
          policy_content: string
          title: string
          updated_at: string
          updated_by_user_id: string | null
          version_label: string | null
        }
        Insert: {
          active_flag?: boolean
          created_at?: string
          id?: string
          policy_content: string
          title: string
          updated_at?: string
          updated_by_user_id?: string | null
          version_label?: string | null
        }
        Update: {
          active_flag?: boolean
          created_at?: string
          id?: string
          policy_content?: string
          title?: string
          updated_at?: string
          updated_by_user_id?: string | null
          version_label?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      actor_type: "staff" | "manager" | "admin" | "system"
      app_role: "staff" | "manager" | "admin" | "superadmin" | "office_manager"
      approval_source: "manager" | "system_auto_approved"
      calendar_action_type: "create" | "update" | "delete" | "failed"
      day_portion: "full" | "am" | "pm"
      request_status: "pending_approval" | "approved" | "rejected" | "cancelled"
      request_type: "vacation" | "sick"
      slack_message_state: "active" | "handled" | "cancelled"
      slack_message_type:
        | "submission_confirmation"
        | "approval_request"
        | "approval_notification"
        | "rejection_notification"
        | "edit_notification"
        | "cancellation_notification"
        | "auto_approved_notification"
      user_status: "active" | "inactive"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      actor_type: ["staff", "manager", "admin", "system"],
      app_role: ["staff", "manager", "admin", "superadmin", "office_manager"],
      approval_source: ["manager", "system_auto_approved"],
      calendar_action_type: ["create", "update", "delete", "failed"],
      day_portion: ["full", "am", "pm"],
      request_status: ["pending_approval", "approved", "rejected", "cancelled"],
      request_type: ["vacation", "sick"],
      slack_message_state: ["active", "handled", "cancelled"],
      slack_message_type: [
        "submission_confirmation",
        "approval_request",
        "approval_notification",
        "rejection_notification",
        "edit_notification",
        "cancellation_notification",
        "auto_approved_notification",
      ],
      user_status: ["active", "inactive"],
    },
  },
} as const
