export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.1';
  };
  public: {
    Tables: {
      abandoned_carts: {
        Row: {
          created_at: string | null;
          discount_code: string | null;
          email: string;
          email_sent: boolean | null;
          expires_at: string;
          id: string;
          items: Json;
          last_reminder_at: string | null;
          recovered: boolean | null;
          reminder_count: number;
          total: number | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          discount_code?: string | null;
          email: string;
          email_sent?: boolean | null;
          expires_at: string;
          id: string;
          items?: Json;
          last_reminder_at?: string | null;
          recovered?: boolean | null;
          reminder_count?: number;
          total?: number | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          discount_code?: string | null;
          email?: string;
          email_sent?: boolean | null;
          expires_at?: string;
          id?: string;
          items?: Json;
          last_reminder_at?: string | null;
          recovered?: boolean | null;
          reminder_count?: number;
          total?: number | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      account_transactions: {
        Row: {
          account_id: string;
          amount: number;
          created_at: string;
          created_by: string | null;
          description: string | null;
          due_date: string | null;
          id: string;
          is_paid: boolean | null;
          order_id: string | null;
          paid_at: string | null;
          payment_id: string | null;
          reference_number: string | null;
          transaction_type: string;
        };
        Insert: {
          account_id: string;
          amount: number;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          is_paid?: boolean | null;
          order_id?: string | null;
          paid_at?: string | null;
          payment_id?: string | null;
          reference_number?: string | null;
          transaction_type: string;
        };
        Update: {
          account_id?: string;
          amount?: number;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          due_date?: string | null;
          id?: string;
          is_paid?: boolean | null;
          order_id?: string | null;
          paid_at?: string | null;
          payment_id?: string | null;
          reference_number?: string | null;
          transaction_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'account_transactions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'aging_report';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'account_transactions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'customer_accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'account_transactions_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      addresses: {
        Row: {
          address_line: string;
          city: string;
          company_name: string | null;
          created_at: string;
          district: string;
          id: string;
          is_default: boolean;
          neighborhood: string | null;
          phone: string;
          postal_code: string | null;
          recipient_name: string;
          tax_no: string | null;
          tax_office: string | null;
          title: string;
          type: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          address_line: string;
          city: string;
          company_name?: string | null;
          created_at?: string;
          district: string;
          id?: string;
          is_default?: boolean;
          neighborhood?: string | null;
          phone: string;
          postal_code?: string | null;
          recipient_name: string;
          tax_no?: string | null;
          tax_office?: string | null;
          title: string;
          type?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          address_line?: string;
          city?: string;
          company_name?: string | null;
          created_at?: string;
          district?: string;
          id?: string;
          is_default?: boolean;
          neighborhood?: string | null;
          phone?: string;
          postal_code?: string | null;
          recipient_name?: string;
          tax_no?: string | null;
          tax_office?: string | null;
          title?: string;
          type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'addresses_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      admin_action_log: {
        Row: {
          action: string;
          actor_email: string | null;
          actor_id: string | null;
          created_at: string;
          diff: Json | null;
          id: string;
          ip: unknown;
          metadata: Json | null;
          target_id: string | null;
          target_table: string | null;
          user_agent: string | null;
        };
        Insert: {
          action: string;
          actor_email?: string | null;
          actor_id?: string | null;
          created_at?: string;
          diff?: Json | null;
          id?: string;
          ip?: unknown;
          metadata?: Json | null;
          target_id?: string | null;
          target_table?: string | null;
          user_agent?: string | null;
        };
        Update: {
          action?: string;
          actor_email?: string | null;
          actor_id?: string | null;
          created_at?: string;
          diff?: Json | null;
          id?: string;
          ip?: unknown;
          metadata?: Json | null;
          target_id?: string | null;
          target_table?: string | null;
          user_agent?: string | null;
        };
        Relationships: [];
      };
      admin_audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          details: Json;
          id: string;
          target_id: string | null;
          target_table: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          details?: Json;
          id?: string;
          target_id?: string | null;
          target_table?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          details?: Json;
          id?: string;
          target_id?: string | null;
          target_table?: string | null;
        };
        Relationships: [];
      };
      admin_notification_settings: {
        Row: {
          admin_email: string;
          channel_email: boolean;
          channel_in_app: boolean;
          created_at: string;
          daily_digest_time: string | null;
          id: string;
          notify_low_stock: boolean;
          notify_new_order: boolean;
          notify_new_user: boolean;
          notify_order_status: boolean;
          notify_payment_failed: boolean;
          updated_at: string;
        };
        Insert: {
          admin_email: string;
          channel_email?: boolean;
          channel_in_app?: boolean;
          created_at?: string;
          daily_digest_time?: string | null;
          id?: string;
          notify_low_stock?: boolean;
          notify_new_order?: boolean;
          notify_new_user?: boolean;
          notify_order_status?: boolean;
          notify_payment_failed?: boolean;
          updated_at?: string;
        };
        Update: {
          admin_email?: string;
          channel_email?: boolean;
          channel_in_app?: boolean;
          created_at?: string;
          daily_digest_time?: string | null;
          id?: string;
          notify_low_stock?: boolean;
          notify_new_order?: boolean;
          notify_new_user?: boolean;
          notify_order_status?: boolean;
          notify_payment_failed?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      approval_notifications: {
        Row: {
          approval_id: string;
          created_at: string;
          id: string;
          is_read: boolean | null;
          recipient_id: string;
          type: string;
        };
        Insert: {
          approval_id: string;
          created_at?: string;
          id: string;
          is_read?: boolean | null;
          recipient_id: string;
          type?: string;
        };
        Update: {
          approval_id?: string;
          created_at?: string;
          id?: string;
          is_read?: boolean | null;
          recipient_id?: string;
          type?: string;
        };
        Relationships: [];
      };
      auth_events: {
        Row: {
          created_at: string;
          email: string | null;
          event_type: string;
          id: string;
          ip: string | null;
          metadata: Json | null;
          user_agent: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          event_type: string;
          id?: string;
          ip?: string | null;
          metadata?: Json | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          event_type?: string;
          id?: string;
          ip?: string | null;
          metadata?: Json | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'auth_events_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      backorder_logs: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          new_status: string;
          note: string | null;
          old_status: string | null;
          order_item_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          new_status: string;
          note?: string | null;
          old_status?: string | null;
          order_item_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          new_status?: string;
          note?: string | null;
          old_status?: string | null;
          order_item_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'backorder_logs_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'backorder_logs_order_item_id_fkey';
            columns: ['order_item_id'];
            isOneToOne: false;
            referencedRelation: 'order_items';
            referencedColumns: ['id'];
          },
        ];
      };
      banners: {
        Row: {
          created_at: string;
          display_order: number;
          ends_at: string | null;
          id: string;
          image_url: string;
          is_active: boolean;
          link_url: string | null;
          position: string;
          starts_at: string | null;
          target_audience: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_order?: number;
          ends_at?: string | null;
          id?: string;
          image_url: string;
          is_active?: boolean;
          link_url?: string | null;
          position?: string;
          starts_at?: string | null;
          target_audience?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_order?: number;
          ends_at?: string | null;
          id?: string;
          image_url?: string;
          is_active?: boolean;
          link_url?: string | null;
          position?: string;
          starts_at?: string | null;
          target_audience?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      blog_posts: {
        Row: {
          author_id: string | null;
          author_name: string | null;
          category: string | null;
          content: string;
          cover_image: string | null;
          created_at: string;
          excerpt: string | null;
          id: string;
          meta_description: string | null;
          meta_title: string | null;
          published_at: string | null;
          related_product_ids: string[];
          slug: string;
          status: string;
          tags: string[];
          title: string;
          updated_at: string;
          view_count: number;
        };
        Insert: {
          author_id?: string | null;
          author_name?: string | null;
          category?: string | null;
          content: string;
          cover_image?: string | null;
          created_at?: string;
          excerpt?: string | null;
          id?: string;
          meta_description?: string | null;
          meta_title?: string | null;
          published_at?: string | null;
          related_product_ids?: string[];
          slug: string;
          status?: string;
          tags?: string[];
          title: string;
          updated_at?: string;
          view_count?: number;
        };
        Update: {
          author_id?: string | null;
          author_name?: string | null;
          category?: string | null;
          content?: string;
          cover_image?: string | null;
          created_at?: string;
          excerpt?: string | null;
          id?: string;
          meta_description?: string | null;
          meta_title?: string | null;
          published_at?: string | null;
          related_product_ids?: string[];
          slug?: string;
          status?: string;
          tags?: string[];
          title?: string;
          updated_at?: string;
          view_count?: number;
        };
        Relationships: [];
      };
      brands: {
        Row: {
          country: string | null;
          created_at: string;
          description: string | null;
          display_order: number;
          hero_image: string | null;
          is_active: boolean;
          is_featured: boolean;
          logo_url: string | null;
          meta_description: string | null;
          meta_title: string | null;
          name: string;
          slug: string;
          updated_at: string;
          website_url: string | null;
        };
        Insert: {
          country?: string | null;
          created_at?: string;
          description?: string | null;
          display_order?: number;
          hero_image?: string | null;
          is_active?: boolean;
          is_featured?: boolean;
          logo_url?: string | null;
          meta_description?: string | null;
          meta_title?: string | null;
          name: string;
          slug: string;
          updated_at?: string;
          website_url?: string | null;
        };
        Update: {
          country?: string | null;
          created_at?: string;
          description?: string | null;
          display_order?: number;
          hero_image?: string | null;
          is_active?: boolean;
          is_featured?: boolean;
          logo_url?: string | null;
          meta_description?: string | null;
          meta_title?: string | null;
          name?: string;
          slug?: string;
          updated_at?: string;
          website_url?: string | null;
        };
        Relationships: [];
      };
      bulk_order_logs: {
        Row: {
          created_at: string;
          errors: Json | null;
          failed_rows: number;
          file_name: string;
          id: string;
          successful_rows: number;
          total_rows: number;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          errors?: Json | null;
          failed_rows?: number;
          file_name: string;
          id?: string;
          successful_rows?: number;
          total_rows?: number;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          errors?: Json | null;
          failed_rows?: number;
          file_name?: string;
          id?: string;
          successful_rows?: number;
          total_rows?: number;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'bulk_order_logs_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      campaign_usage: {
        Row: {
          campaign_id: string;
          created_at: string;
          discount_amount: number;
          id: string;
          items_affected: number | null;
          order_id: string | null;
          user_id: string;
        };
        Insert: {
          campaign_id: string;
          created_at?: string;
          discount_amount: number;
          id?: string;
          items_affected?: number | null;
          order_id?: string | null;
          user_id: string;
        };
        Update: {
          campaign_id?: string;
          created_at?: string;
          discount_amount?: number;
          id?: string;
          items_affected?: number | null;
          order_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'campaign_usage_campaign_id_fkey';
            columns: ['campaign_id'];
            isOneToOne: false;
            referencedRelation: 'campaigns';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'campaign_usage_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      campaigns: {
        Row: {
          bundle_products: Json | null;
          constraints: Json | null;
          created_at: string;
          created_by: string | null;
          display_text: string;
          end_date: string;
          id: string;
          is_active: boolean | null;
          name: string;
          priority: number | null;
          progress_text: string | null;
          reward: Json | null;
          start_date: string;
          target_product: Json | null;
          tiers: Json | null;
          trigger_product: Json;
          type: string;
          updated_at: string;
        };
        Insert: {
          bundle_products?: Json | null;
          constraints?: Json | null;
          created_at?: string;
          created_by?: string | null;
          display_text: string;
          end_date: string;
          id?: string;
          is_active?: boolean | null;
          name: string;
          priority?: number | null;
          progress_text?: string | null;
          reward?: Json | null;
          start_date: string;
          target_product?: Json | null;
          tiers?: Json | null;
          trigger_product?: Json;
          type: string;
          updated_at?: string;
        };
        Update: {
          bundle_products?: Json | null;
          constraints?: Json | null;
          created_at?: string;
          created_by?: string | null;
          display_text?: string;
          end_date?: string;
          id?: string;
          is_active?: boolean | null;
          name?: string;
          priority?: number | null;
          progress_text?: string | null;
          reward?: Json | null;
          start_date?: string;
          target_product?: Json | null;
          tiers?: Json | null;
          trigger_product?: Json;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'campaigns_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      cart_items: {
        Row: {
          created_at: string | null;
          id: string;
          product_id: string | null;
          quantity: number;
          selected_options: Json | null;
          session_id: string | null;
          unit_price: number;
          updated_at: string | null;
          user_id: string | null;
          variant_sku: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          product_id?: string | null;
          quantity?: number;
          selected_options?: Json | null;
          session_id?: string | null;
          unit_price: number;
          updated_at?: string | null;
          user_id?: string | null;
          variant_sku?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          product_id?: string | null;
          quantity?: number;
          selected_options?: Json | null;
          session_id?: string | null;
          unit_price?: number;
          updated_at?: string | null;
          user_id?: string | null;
          variant_sku?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'cart_items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      categories: {
        Row: {
          color_code: string | null;
          description: string | null;
          id: string;
          is_active: boolean | null;
          name: string;
          parent_id: string | null;
          slug: string;
        };
        Insert: {
          color_code?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean | null;
          name: string;
          parent_id?: string | null;
          slug: string;
        };
        Update: {
          color_code?: string | null;
          description?: string | null;
          id?: string;
          is_active?: boolean | null;
          name?: string;
          parent_id?: string | null;
          slug?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'categories_parent_id_fkey';
            columns: ['parent_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
        ];
      };
      clinic_sample_limits: {
        Row: {
          clinic_id: string;
          created_at: string;
          id: string;
          max_samples: number | null;
          product_id: string;
          used_samples: number | null;
        };
        Insert: {
          clinic_id: string;
          created_at?: string;
          id?: string;
          max_samples?: number | null;
          product_id: string;
          used_samples?: number | null;
        };
        Update: {
          clinic_id?: string;
          created_at?: string;
          id?: string;
          max_samples?: number | null;
          product_id?: string;
          used_samples?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'clinic_sample_limits_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      clinical_usage: {
        Row: {
          description: string | null;
          id: string;
          product_id: string | null;
          recommendations: string | null;
          rpm_range: string | null;
          torque_range: string | null;
          usage_type: string | null;
        };
        Insert: {
          description?: string | null;
          id?: string;
          product_id?: string | null;
          recommendations?: string | null;
          rpm_range?: string | null;
          torque_range?: string | null;
          usage_type?: string | null;
        };
        Update: {
          description?: string | null;
          id?: string;
          product_id?: string | null;
          recommendations?: string | null;
          rpm_range?: string | null;
          torque_range?: string | null;
          usage_type?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'clinical_usage_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      consumption_alerts: {
        Row: {
          alert_status: string;
          avg_consumption_days: number;
          client_id: string;
          created_at: string;
          id: string;
          last_order_date: string;
          notified_at: string | null;
          predicted_runout_date: string;
          product_id: string;
          product_name: string | null;
          variant_id: string | null;
        };
        Insert: {
          alert_status?: string;
          avg_consumption_days: number;
          client_id: string;
          created_at?: string;
          id?: string;
          last_order_date: string;
          notified_at?: string | null;
          predicted_runout_date: string;
          product_id: string;
          product_name?: string | null;
          variant_id?: string | null;
        };
        Update: {
          alert_status?: string;
          avg_consumption_days?: number;
          client_id?: string;
          created_at?: string;
          id?: string;
          last_order_date?: string;
          notified_at?: string | null;
          predicted_runout_date?: string;
          product_id?: string;
          product_name?: string | null;
          variant_id?: string | null;
        };
        Relationships: [];
      };
      contact_messages: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          ip_address: string | null;
          message: string;
          name: string;
          phone: string | null;
          status: string;
          subject: string | null;
          updated_at: string;
          user_agent: string | null;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          ip_address?: string | null;
          message: string;
          name: string;
          phone?: string | null;
          status?: string;
          subject?: string | null;
          updated_at?: string;
          user_agent?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          ip_address?: string | null;
          message?: string;
          name?: string;
          phone?: string | null;
          status?: string;
          subject?: string | null;
          updated_at?: string;
          user_agent?: string | null;
        };
        Relationships: [];
      };
      coupon_redemptions: {
        Row: {
          coupon_id: string;
          discount_amount: number;
          id: string;
          order_id: string | null;
          redeemed_at: string | null;
          user_id: string;
        };
        Insert: {
          coupon_id: string;
          discount_amount: number;
          id?: string;
          order_id?: string | null;
          redeemed_at?: string | null;
          user_id: string;
        };
        Update: {
          coupon_id?: string;
          discount_amount?: number;
          id?: string;
          order_id?: string | null;
          redeemed_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'coupon_redemptions_coupon_id_fkey';
            columns: ['coupon_id'];
            isOneToOne: false;
            referencedRelation: 'coupons';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'coupon_redemptions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      coupons: {
        Row: {
          applicable_to: string;
          code: string;
          created_at: string | null;
          created_by: string | null;
          description: string | null;
          discount_type: string;
          discount_value: number;
          expires_at: string | null;
          id: string;
          is_active: boolean;
          kit_only: boolean;
          max_uses: number | null;
          min_cart_amount: number | null;
          min_item_count: number | null;
          starts_at: string | null;
          target_ids: Json;
          updated_at: string | null;
          used_count: number;
          user_segment: string;
        };
        Insert: {
          applicable_to?: string;
          code: string;
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          discount_type: string;
          discount_value: number;
          expires_at?: string | null;
          id?: string;
          is_active?: boolean;
          kit_only?: boolean;
          max_uses?: number | null;
          min_cart_amount?: number | null;
          min_item_count?: number | null;
          starts_at?: string | null;
          target_ids?: Json;
          updated_at?: string | null;
          used_count?: number;
          user_segment?: string;
        };
        Update: {
          applicable_to?: string;
          code?: string;
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          discount_type?: string;
          discount_value?: number;
          expires_at?: string | null;
          id?: string;
          is_active?: boolean;
          kit_only?: boolean;
          max_uses?: number | null;
          min_cart_amount?: number | null;
          min_item_count?: number | null;
          starts_at?: string | null;
          target_ids?: Json;
          updated_at?: string | null;
          used_count?: number;
          user_segment?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'coupons_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      cron_runs: {
        Row: {
          created_at: string;
          duration_ms: number | null;
          error_message: string | null;
          finished_at: string | null;
          id: string;
          job_name: string;
          metadata: Json | null;
          started_at: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          duration_ms?: number | null;
          error_message?: string | null;
          finished_at?: string | null;
          id?: string;
          job_name: string;
          metadata?: Json | null;
          started_at?: string;
          status: string;
        };
        Update: {
          created_at?: string;
          duration_ms?: number | null;
          error_message?: string | null;
          finished_at?: string | null;
          id?: string;
          job_name?: string;
          metadata?: Json | null;
          started_at?: string;
          status?: string;
        };
        Relationships: [];
      };
      cron_schedules: {
        Row: {
          description: string | null;
          enabled: boolean;
          job_name: string;
          schedule: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          description?: string | null;
          enabled?: boolean;
          job_name: string;
          schedule: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          description?: string | null;
          enabled?: boolean;
          job_name?: string;
          schedule?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      customer_accounts: {
        Row: {
          account_code: string;
          authorized_person: string | null;
          authorized_phone: string | null;
          available_credit: number | null;
          created_at: string | null;
          credit_limit: number;
          current_balance: number;
          id: string;
          late_payment_interest: number | null;
          payment_term_days: number | null;
          risk_level: string | null;
          status: string | null;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          account_code: string;
          authorized_person?: string | null;
          authorized_phone?: string | null;
          available_credit?: number | null;
          created_at?: string | null;
          credit_limit?: number;
          current_balance?: number;
          id?: string;
          late_payment_interest?: number | null;
          payment_term_days?: number | null;
          risk_level?: string | null;
          status?: string | null;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          account_code?: string;
          authorized_person?: string | null;
          authorized_phone?: string | null;
          available_credit?: number | null;
          created_at?: string | null;
          credit_limit?: number;
          current_balance?: number;
          id?: string;
          late_payment_interest?: number | null;
          payment_term_days?: number | null;
          risk_level?: string | null;
          status?: string | null;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_accounts_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      debt_payment_sessions: {
        Row: {
          amount: number;
          conversation_id: string;
          created_at: string;
          status: string;
          transaction_ids: string[];
          user_id: string;
        };
        Insert: {
          amount: number;
          conversation_id: string;
          created_at?: string;
          status?: string;
          transaction_ids: string[];
          user_id: string;
        };
        Update: {
          amount?: number;
          conversation_id?: string;
          created_at?: string;
          status?: string;
          transaction_ids?: string[];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'debt_payment_sessions_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      device_tokens: {
        Row: {
          created_at: string | null;
          id: string;
          last_seen_at: string | null;
          platform: string;
          token: string;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          last_seen_at?: string | null;
          platform?: string;
          token: string;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          last_seen_at?: string | null;
          platform?: string;
          token?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      doctor_approvals: {
        Row: {
          admin_notes: string | null;
          approved_at: string | null;
          doctor_data: Json;
          doctor_id: string | null;
          id: string;
          priority: string | null;
          rejected_at: string | null;
          rejection_reason: string | null;
          status: string;
          submitted_at: string;
          token: string;
        };
        Insert: {
          admin_notes?: string | null;
          approved_at?: string | null;
          doctor_data: Json;
          doctor_id?: string | null;
          id?: string;
          priority?: string | null;
          rejected_at?: string | null;
          rejection_reason?: string | null;
          status?: string;
          submitted_at?: string;
          token: string;
        };
        Update: {
          admin_notes?: string | null;
          approved_at?: string | null;
          doctor_data?: Json;
          doctor_id?: string | null;
          id?: string;
          priority?: string | null;
          rejected_at?: string | null;
          rejection_reason?: string | null;
          status?: string;
          submitted_at?: string;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'doctor_approvals_doctor_id_fkey';
            columns: ['doctor_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      email_logs: {
        Row: {
          created_at: string;
          error_message: string | null;
          id: string;
          metadata: Json | null;
          notification_id: string | null;
          provider: string | null;
          provider_id: string | null;
          sent_at: string | null;
          status: Database['public']['Enums']['notification_status'];
          subject: string;
          template_name: string | null;
          to_email: string;
        };
        Insert: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          metadata?: Json | null;
          notification_id?: string | null;
          provider?: string | null;
          provider_id?: string | null;
          sent_at?: string | null;
          status?: Database['public']['Enums']['notification_status'];
          subject: string;
          template_name?: string | null;
          to_email: string;
        };
        Update: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          metadata?: Json | null;
          notification_id?: string | null;
          provider?: string | null;
          provider_id?: string | null;
          sent_at?: string | null;
          status?: Database['public']['Enums']['notification_status'];
          subject?: string;
          template_name?: string | null;
          to_email?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'email_logs_notification_id_fkey';
            columns: ['notification_id'];
            isOneToOne: false;
            referencedRelation: 'notifications';
            referencedColumns: ['id'];
          },
        ];
      };
      email_templates: {
        Row: {
          body_html: string;
          body_text: string | null;
          created_at: string;
          is_active: boolean;
          key: string;
          subject: string;
          updated_at: string;
          updated_by: string | null;
          variables: Json;
        };
        Insert: {
          body_html: string;
          body_text?: string | null;
          created_at?: string;
          is_active?: boolean;
          key: string;
          subject: string;
          updated_at?: string;
          updated_by?: string | null;
          variables?: Json;
        };
        Update: {
          body_html?: string;
          body_text?: string | null;
          created_at?: string;
          is_active?: boolean;
          key?: string;
          subject?: string;
          updated_at?: string;
          updated_by?: string | null;
          variables?: Json;
        };
        Relationships: [];
      };
      email_templates_history: {
        Row: {
          archived_at: string;
          body_html: string;
          body_text: string | null;
          id: string;
          is_active: boolean;
          key: string;
          subject: string;
          updated_by: string | null;
          variables: Json;
        };
        Insert: {
          archived_at?: string;
          body_html: string;
          body_text?: string | null;
          id?: string;
          is_active: boolean;
          key: string;
          subject: string;
          updated_by?: string | null;
          variables: Json;
        };
        Update: {
          archived_at?: string;
          body_html?: string;
          body_text?: string | null;
          id?: string;
          is_active?: boolean;
          key?: string;
          subject?: string;
          updated_by?: string | null;
          variables?: Json;
        };
        Relationships: [];
      };
      email_verification_tokens: {
        Row: {
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          token: string;
          used_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          expires_at: string;
          id?: string;
          token: string;
          used_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          token?: string;
          used_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      invoices: {
        Row: {
          cancellation_reason: string | null;
          cancelled_at: string | null;
          created_at: string;
          e_invoice_delivered_at: string | null;
          e_invoice_id: string | null;
          e_invoice_pdf_url: string | null;
          e_invoice_sent_at: string | null;
          e_invoice_status: string | null;
          e_invoice_uuid: string | null;
          e_invoice_xml_url: string | null;
          id: string;
          invoice_number: string;
          invoice_series: string | null;
          is_cancelled: boolean | null;
          order_id: string | null;
          provider: string | null;
          provider_response: Json | null;
          recipient_address: string | null;
          recipient_company_name: string | null;
          recipient_email: string | null;
          recipient_name: string | null;
          recipient_phone: string | null;
          recipient_tax_number: string | null;
          recipient_tax_office: string | null;
          subtotal: number | null;
          total_amount: number | null;
          type: string;
          updated_at: string;
          user_id: string | null;
          vat_breakdown: Json | null;
          vat_total: number | null;
        };
        Insert: {
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          e_invoice_delivered_at?: string | null;
          e_invoice_id?: string | null;
          e_invoice_pdf_url?: string | null;
          e_invoice_sent_at?: string | null;
          e_invoice_status?: string | null;
          e_invoice_uuid?: string | null;
          e_invoice_xml_url?: string | null;
          id?: string;
          invoice_number: string;
          invoice_series?: string | null;
          is_cancelled?: boolean | null;
          order_id?: string | null;
          provider?: string | null;
          provider_response?: Json | null;
          recipient_address?: string | null;
          recipient_company_name?: string | null;
          recipient_email?: string | null;
          recipient_name?: string | null;
          recipient_phone?: string | null;
          recipient_tax_number?: string | null;
          recipient_tax_office?: string | null;
          subtotal?: number | null;
          total_amount?: number | null;
          type: string;
          updated_at?: string;
          user_id?: string | null;
          vat_breakdown?: Json | null;
          vat_total?: number | null;
        };
        Update: {
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          created_at?: string;
          e_invoice_delivered_at?: string | null;
          e_invoice_id?: string | null;
          e_invoice_pdf_url?: string | null;
          e_invoice_sent_at?: string | null;
          e_invoice_status?: string | null;
          e_invoice_uuid?: string | null;
          e_invoice_xml_url?: string | null;
          id?: string;
          invoice_number?: string;
          invoice_series?: string | null;
          is_cancelled?: boolean | null;
          order_id?: string | null;
          provider?: string | null;
          provider_response?: Json | null;
          recipient_address?: string | null;
          recipient_company_name?: string | null;
          recipient_email?: string | null;
          recipient_name?: string | null;
          recipient_phone?: string | null;
          recipient_tax_number?: string | null;
          recipient_tax_office?: string | null;
          subtotal?: number | null;
          total_amount?: number | null;
          type?: string;
          updated_at?: string;
          user_id?: string | null;
          vat_breakdown?: Json | null;
          vat_total?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'invoices_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'invoices_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      kit_templates: {
        Row: {
          brand_slug: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          discount_pct: number | null;
          display_order: number;
          id: string;
          image_url: string | null;
          is_active: boolean;
          items: Json;
          min_items: number;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          brand_slug?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          discount_pct?: number | null;
          display_order?: number;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          items?: Json;
          min_items?: number;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          brand_slug?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          discount_pct?: number | null;
          display_order?: number;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          items?: Json;
          min_items?: number;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      legal_pages: {
        Row: {
          content: string;
          created_at: string;
          is_published: boolean;
          slug: string;
          title: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          content: string;
          created_at?: string;
          is_published?: boolean;
          slug: string;
          title: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          content?: string;
          created_at?: string;
          is_published?: boolean;
          slug?: string;
          title?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [];
      };
      legal_pages_history: {
        Row: {
          archived_at: string;
          content: string;
          id: string;
          is_published: boolean;
          slug: string;
          title: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          archived_at?: string;
          content: string;
          id?: string;
          is_published: boolean;
          slug: string;
          title: string;
          updated_by?: string | null;
          version: number;
        };
        Update: {
          archived_at?: string;
          content?: string;
          id?: string;
          is_published?: boolean;
          slug?: string;
          title?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [];
      };
      legal_slug_history: {
        Row: {
          changed_at: string;
          changed_by: string | null;
          id: string;
          new_slug: string;
          old_slug: string;
        };
        Insert: {
          changed_at?: string;
          changed_by?: string | null;
          id?: string;
          new_slug: string;
          old_slug: string;
        };
        Update: {
          changed_at?: string;
          changed_by?: string | null;
          id?: string;
          new_slug?: string;
          old_slug?: string;
        };
        Relationships: [];
      };
      newsletter_subscribers: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          is_active: boolean;
          kvkk_consent: boolean;
          source: string;
          unsubscribed_at: string | null;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
          is_active?: boolean;
          kvkk_consent?: boolean;
          source?: string;
          unsubscribed_at?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          is_active?: boolean;
          kvkk_consent?: boolean;
          source?: string;
          unsubscribed_at?: string | null;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          created_at: string;
          data: Json | null;
          id: string;
          is_read: boolean;
          message: string;
          read_at: string | null;
          title: string;
          type: Database['public']['Enums']['notification_type'];
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          data?: Json | null;
          id?: string;
          is_read?: boolean;
          message: string;
          read_at?: string | null;
          title: string;
          type: Database['public']['Enums']['notification_type'];
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          data?: Json | null;
          id?: string;
          is_read?: boolean;
          message?: string;
          read_at?: string | null;
          title?: string;
          type?: Database['public']['Enums']['notification_type'];
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      order_items: {
        Row: {
          backorder_eta: string | null;
          created_at: string | null;
          currency: string | null;
          exchange_rate: number | null;
          id: string;
          is_backorder: boolean | null;
          item_status: string | null;
          line_total: number | null;
          order_id: string | null;
          product_id: string | null;
          product_name: string;
          quantity: number;
          quantity_delivered: number | null;
          selected_options: Json | null;
          sku: string;
          unit_price: number;
          variant_id: string | null;
        };
        Insert: {
          backorder_eta?: string | null;
          created_at?: string | null;
          currency?: string | null;
          exchange_rate?: number | null;
          id?: string;
          is_backorder?: boolean | null;
          item_status?: string | null;
          line_total?: number | null;
          order_id?: string | null;
          product_id?: string | null;
          product_name: string;
          quantity: number;
          quantity_delivered?: number | null;
          selected_options?: Json | null;
          sku: string;
          unit_price: number;
          variant_id?: string | null;
        };
        Update: {
          backorder_eta?: string | null;
          created_at?: string | null;
          currency?: string | null;
          exchange_rate?: number | null;
          id?: string;
          is_backorder?: boolean | null;
          item_status?: string | null;
          line_total?: number | null;
          order_id?: string | null;
          product_id?: string | null;
          product_name?: string;
          quantity?: number;
          quantity_delivered?: number | null;
          selected_options?: Json | null;
          sku?: string;
          unit_price?: number;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'order_items_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_items_variant_id_fkey';
            columns: ['variant_id'];
            isOneToOne: false;
            referencedRelation: 'variant_combinations';
            referencedColumns: ['id'];
          },
        ];
      };
      order_shipments: {
        Row: {
          carrier: string | null;
          created_at: string;
          delivered_at: string | null;
          estimated_delivery: string | null;
          id: string;
          item_count: number;
          notes: string | null;
          order_id: string;
          shipment_number: string;
          shipment_type: string | null;
          shipping_date: string | null;
          status: string | null;
          tracking_number: string | null;
          updated_at: string;
        };
        Insert: {
          carrier?: string | null;
          created_at?: string;
          delivered_at?: string | null;
          estimated_delivery?: string | null;
          id?: string;
          item_count?: number;
          notes?: string | null;
          order_id: string;
          shipment_number: string;
          shipment_type?: string | null;
          shipping_date?: string | null;
          status?: string | null;
          tracking_number?: string | null;
          updated_at?: string;
        };
        Update: {
          carrier?: string | null;
          created_at?: string;
          delivered_at?: string | null;
          estimated_delivery?: string | null;
          id?: string;
          item_count?: number;
          notes?: string | null;
          order_id?: string;
          shipment_number?: string;
          shipment_type?: string | null;
          shipping_date?: string | null;
          status?: string | null;
          tracking_number?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'order_shipments_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      orders: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          assistant_status: Database['public']['Enums']['assistant_approval_status'] | null;
          backorder_status: string | null;
          billing_address: Json | null;
          billing_address_id: string | null;
          cari_id: string | null;
          carrier: string | null;
          clinic_id: string | null;
          coupon_id: string | null;
          created_at: string | null;
          deleted_at: string | null;
          delivery_type: string | null;
          discount_amount: number | null;
          email_sent: boolean | null;
          id: string;
          idempotency_key: string | null;
          invoice_status: string | null;
          iyzipay_conversation_id: string | null;
          iyzipay_payment_id: string | null;
          iyzipay_payment_transaction_ids: Json | null;
          iyzipay_token: string | null;
          notes: string | null;
          order_number: string;
          payment_method: string | null;
          payment_provider: string | null;
          payment_ref: string | null;
          payment_status: string | null;
          refund_note: string | null;
          refunded_at: string | null;
          refunded_by: string | null;
          rejection_reason: string | null;
          reservation_session: string | null;
          sales_rep_id: string | null;
          shipping_address: Json | null;
          shipping_address_id: string | null;
          shipping_amount: number;
          shipping_company: string | null;
          shipping_status: string | null;
          status: string | null;
          subtotal: number | null;
          total: number | null;
          total_amount: number;
          tracking_no: string | null;
          tracking_number: string | null;
          updated_at: string | null;
          user_id: string | null;
          vat_amount: number | null;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          assistant_status?: Database['public']['Enums']['assistant_approval_status'] | null;
          backorder_status?: string | null;
          billing_address?: Json | null;
          billing_address_id?: string | null;
          cari_id?: string | null;
          carrier?: string | null;
          clinic_id?: string | null;
          coupon_id?: string | null;
          created_at?: string | null;
          delivery_type?: string | null;
          discount_amount?: number | null;
          email_sent?: boolean | null;
          id?: string;
          idempotency_key?: string | null;
          invoice_status?: string | null;
          iyzipay_conversation_id?: string | null;
          iyzipay_payment_id?: string | null;
          iyzipay_payment_transaction_ids?: Json | null;
          iyzipay_token?: string | null;
          notes?: string | null;
          order_number: string;
          payment_method?: string | null;
          payment_provider?: string | null;
          payment_ref?: string | null;
          payment_status?: string | null;
          refund_note?: string | null;
          refunded_at?: string | null;
          refunded_by?: string | null;
          rejection_reason?: string | null;
          reservation_session?: string | null;
          sales_rep_id?: string | null;
          shipping_address?: Json | null;
          shipping_address_id?: string | null;
          shipping_amount?: number;
          shipping_company?: string | null;
          shipping_status?: string | null;
          status?: string | null;
          subtotal?: number | null;
          total?: number | null;
          total_amount: number;
          tracking_no?: string | null;
          tracking_number?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
          vat_amount?: number | null;
          deleted_at?: string | null;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          assistant_status?: Database['public']['Enums']['assistant_approval_status'] | null;
          backorder_status?: string | null;
          billing_address?: Json | null;
          billing_address_id?: string | null;
          cari_id?: string | null;
          carrier?: string | null;
          clinic_id?: string | null;
          coupon_id?: string | null;
          created_at?: string | null;
          delivery_type?: string | null;
          discount_amount?: number | null;
          email_sent?: boolean | null;
          id?: string;
          idempotency_key?: string | null;
          invoice_status?: string | null;
          iyzipay_conversation_id?: string | null;
          iyzipay_payment_id?: string | null;
          iyzipay_payment_transaction_ids?: Json | null;
          iyzipay_token?: string | null;
          notes?: string | null;
          order_number?: string;
          payment_method?: string | null;
          payment_provider?: string | null;
          payment_ref?: string | null;
          payment_status?: string | null;
          refund_note?: string | null;
          refunded_at?: string | null;
          refunded_by?: string | null;
          rejection_reason?: string | null;
          reservation_session?: string | null;
          sales_rep_id?: string | null;
          shipping_address?: Json | null;
          shipping_address_id?: string | null;
          shipping_amount?: number;
          shipping_company?: string | null;
          shipping_status?: string | null;
          status?: string | null;
          subtotal?: number | null;
          total?: number | null;
          total_amount?: number;
          tracking_no?: string | null;
          tracking_number?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
          vat_amount?: number | null;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'orders_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_billing_address_id_fkey';
            columns: ['billing_address_id'];
            isOneToOne: false;
            referencedRelation: 'addresses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_cari_id_fkey';
            columns: ['cari_id'];
            isOneToOne: false;
            referencedRelation: 'saha_cariler';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_clinic_id_fkey';
            columns: ['clinic_id'];
            isOneToOne: false;
            referencedRelation: 'saha_clinics';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_sales_rep_id_profiles_fkey';
            columns: ['sales_rep_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_shipping_address_id_fkey';
            columns: ['shipping_address_id'];
            isOneToOne: false;
            referencedRelation: 'addresses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'orders_user_id_profiles_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      password_reset_tokens: {
        Row: {
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          token: string;
          used_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          expires_at: string;
          id?: string;
          token: string;
          used_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          token?: string;
          used_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          amount: number;
          bank_name: string | null;
          card_brand: string | null;
          card_last_four: string | null;
          created_at: string;
          due_date: string | null;
          gateway_response: Json | null;
          id: string;
          installment_count: number | null;
          ip_address: string | null;
          is_cari_payment: boolean | null;
          is_partial: boolean | null;
          method: string;
          notes: string | null;
          order_id: string | null;
          parent_payment_id: string | null;
          payment_order: number | null;
          status: string;
          transfer_reference: string | null;
          updated_at: string;
          user_agent: string | null;
          user_id: string | null;
        };
        Insert: {
          amount: number;
          bank_name?: string | null;
          card_brand?: string | null;
          card_last_four?: string | null;
          created_at?: string;
          due_date?: string | null;
          gateway_response?: Json | null;
          id?: string;
          installment_count?: number | null;
          ip_address?: string | null;
          is_cari_payment?: boolean | null;
          is_partial?: boolean | null;
          method: string;
          notes?: string | null;
          order_id?: string | null;
          parent_payment_id?: string | null;
          payment_order?: number | null;
          status?: string;
          transfer_reference?: string | null;
          updated_at?: string;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Update: {
          amount?: number;
          bank_name?: string | null;
          card_brand?: string | null;
          card_last_four?: string | null;
          created_at?: string;
          due_date?: string | null;
          gateway_response?: Json | null;
          id?: string;
          installment_count?: number | null;
          ip_address?: string | null;
          is_cari_payment?: boolean | null;
          is_partial?: boolean | null;
          method?: string;
          notes?: string | null;
          order_id?: string | null;
          parent_payment_id?: string | null;
          payment_order?: number | null;
          status?: string;
          transfer_reference?: string | null;
          updated_at?: string;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'payments_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payments_parent_payment_id_fkey';
            columns: ['parent_payment_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      pending_carts: {
        Row: {
          approval_id: string;
          approved_at: string | null;
          approved_by: string | null;
          clinic_id: string | null;
          created_at: string;
          created_by: string;
          items: Json;
          note: string | null;
          rep_discount: number | null;
          status: string;
          submitted_by_role: string | null;
        };
        Insert: {
          approval_id: string;
          approved_at?: string | null;
          approved_by?: string | null;
          clinic_id?: string | null;
          created_at?: string;
          created_by: string;
          items: Json;
          note?: string | null;
          rep_discount?: number | null;
          status?: string;
          submitted_by_role?: string | null;
        };
        Update: {
          approval_id?: string;
          approved_at?: string | null;
          approved_by?: string | null;
          clinic_id?: string | null;
          created_at?: string;
          created_by?: string;
          items?: Json;
          note?: string | null;
          rep_discount?: number | null;
          status?: string;
          submitted_by_role?: string | null;
        };
        Relationships: [];
      };
      permissions: {
        Row: {
          code: string;
          created_at: string | null;
          description: string;
        };
        Insert: {
          code: string;
          created_at?: string | null;
          description: string;
        };
        Update: {
          code?: string;
          created_at?: string | null;
          description?: string;
        };
        Relationships: [];
      };
      product_badges: {
        Row: {
          badge_color: string | null;
          badge_text: string;
          display_order: number | null;
          id: string;
          product_id: string | null;
        };
        Insert: {
          badge_color?: string | null;
          badge_text: string;
          display_order?: number | null;
          id?: string;
          product_id?: string | null;
        };
        Update: {
          badge_color?: string | null;
          badge_text?: string;
          display_order?: number | null;
          id?: string;
          product_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'product_badges_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      product_reviews: {
        Row: {
          approved: boolean;
          comment: string | null;
          created_at: string;
          id: string;
          product_id: string;
          rating: number;
          title: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          approved?: boolean;
          comment?: string | null;
          created_at?: string;
          id?: string;
          product_id: string;
          rating: number;
          title?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          approved?: boolean;
          comment?: string | null;
          created_at?: string;
          id?: string;
          product_id?: string;
          rating?: number;
          title?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'product_reviews_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      product_slug_history: {
        Row: {
          created_at: string | null;
          new_slug: string;
          old_slug: string;
        };
        Insert: {
          created_at?: string | null;
          new_slug: string;
          old_slug: string;
        };
        Update: {
          created_at?: string | null;
          new_slug?: string;
          old_slug?: string;
        };
        Relationships: [];
      };
      product_specifications: {
        Row: {
          display_order: number | null;
          id: string;
          product_id: string | null;
          spec_group: string | null;
          spec_name: string;
          spec_value: string;
        };
        Insert: {
          display_order?: number | null;
          id?: string;
          product_id?: string | null;
          spec_group?: string | null;
          spec_name: string;
          spec_value: string;
        };
        Update: {
          display_order?: number | null;
          id?: string;
          product_id?: string | null;
          spec_group?: string | null;
          spec_name?: string;
          spec_value?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'product_specifications_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      products: {
        Row: {
          allow_backorder: boolean | null;
          backorder_eta_days: number | null;
          backorder_note: string | null;
          base_code: string | null;
          base_price: number | null;
          brand: string;
          brand_content_jsonb: Json;
          category_id: string | null;
          clearone_expert_protips: Json;
          clearone_indications: Json;
          clearone_key_features: Json;
          clearone_recommended_combinations: Json;
          clearone_technical_properties: Json;
          created_at: string | null;
          currency: string | null;
          description: string | null;
          gallery_images: Json | null;
          id: string;
          is_active: boolean | null;
          is_featured: boolean | null;
          is_imported: boolean | null;
          is_sample: boolean | null;
          main_image: string | null;
          meta_description: string | null;
          meta_title: string | null;
          metadata: Json | null;
          name: string;
          sale_price: number | null;
          sample_description: string | null;
          sample_max_per_clinic: number | null;
          sample_shipping_only: boolean | null;
          short_description: string | null;
          sku: string;
          slug: string;
          sort_order: number | null;
          stock_quantity: number | null;
          stock_status: string | null;
          subcategory_id: string | null;
          tax_rate: number | null;
          technology: string | null;
          updated_at: string | null;
        };
        Insert: {
          allow_backorder?: boolean | null;
          backorder_eta_days?: number | null;
          backorder_note?: string | null;
          base_code?: string | null;
          base_price?: number | null;
          brand?: string;
          brand_content_jsonb?: Json;
          category_id?: string | null;
          clearone_expert_protips?: Json;
          clearone_indications?: Json;
          clearone_key_features?: Json;
          clearone_recommended_combinations?: Json;
          clearone_technical_properties?: Json;
          created_at?: string | null;
          currency?: string | null;
          description?: string | null;
          gallery_images?: Json | null;
          id?: string;
          is_active?: boolean | null;
          is_featured?: boolean | null;
          is_imported?: boolean | null;
          is_sample?: boolean | null;
          main_image?: string | null;
          meta_description?: string | null;
          meta_title?: string | null;
          metadata?: Json | null;
          name: string;
          sale_price?: number | null;
          sample_description?: string | null;
          sample_max_per_clinic?: number | null;
          sample_shipping_only?: boolean | null;
          short_description?: string | null;
          sku: string;
          slug: string;
          sort_order?: number | null;
          stock_quantity?: number | null;
          stock_status?: string | null;
          subcategory_id?: string | null;
          tax_rate?: number | null;
          technology?: string | null;
          updated_at?: string | null;
        };
        Update: {
          allow_backorder?: boolean | null;
          backorder_eta_days?: number | null;
          backorder_note?: string | null;
          base_code?: string | null;
          base_price?: number | null;
          brand?: string;
          brand_content_jsonb?: Json;
          category_id?: string | null;
          clearone_expert_protips?: Json;
          clearone_indications?: Json;
          clearone_key_features?: Json;
          clearone_recommended_combinations?: Json;
          clearone_technical_properties?: Json;
          created_at?: string | null;
          currency?: string | null;
          description?: string | null;
          gallery_images?: Json | null;
          id?: string;
          is_active?: boolean | null;
          is_featured?: boolean | null;
          is_imported?: boolean | null;
          is_sample?: boolean | null;
          main_image?: string | null;
          meta_description?: string | null;
          meta_title?: string | null;
          metadata?: Json | null;
          name?: string;
          sale_price?: number | null;
          sample_description?: string | null;
          sample_max_per_clinic?: number | null;
          sample_shipping_only?: boolean | null;
          short_description?: string | null;
          sku?: string;
          slug?: string;
          sort_order?: number | null;
          stock_quantity?: number | null;
          stock_status?: string | null;
          subcategory_id?: string | null;
          tax_rate?: number | null;
          technology?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'fk_products_cat';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'fk_products_subcat';
            columns: ['subcategory_id'];
            isOneToOne: false;
            referencedRelation: 'subcategories';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          ad_soyad: string | null;
          assistant_clinic_id: string | null;
          avatar_url: string | null;
          avg_fuel_consumption: number | null;
          cart_data: Json | null;
          city: string | null;
          company_name: string | null;
          created_at: string | null;
          diploma_no: string | null;
          diploma_uploaded_at: string | null;
          diploma_url: string | null;
          discount_rate: number | null;
          email: string | null;
          id: string;
          is_approved: boolean | null;
          is_dentist: boolean | null;
          is_verified: boolean | null;
          klinik_adi: string | null;
          kvkk_accepted_at: string | null;
          kvkk_version: string | null;
          max_rep_discount: number | null;
          notification_settings: Json | null;
          plasiyer_id: string | null;
          region: string | null;
          role: string | null;
          tax_number: string | null;
          tax_office: string | null;
          telefon: string | null;
          updated_at: string | null;
          wallet_balance: number | null;
        };
        Insert: {
          ad_soyad?: string | null;
          assistant_clinic_id?: string | null;
          avatar_url?: string | null;
          avg_fuel_consumption?: number | null;
          cart_data?: Json | null;
          city?: string | null;
          company_name?: string | null;
          created_at?: string | null;
          diploma_no?: string | null;
          diploma_uploaded_at?: string | null;
          diploma_url?: string | null;
          discount_rate?: number | null;
          email?: string | null;
          id: string;
          is_approved?: boolean | null;
          is_dentist?: boolean | null;
          is_verified?: boolean | null;
          klinik_adi?: string | null;
          kvkk_accepted_at?: string | null;
          kvkk_version?: string | null;
          max_rep_discount?: number | null;
          notification_settings?: Json | null;
          plasiyer_id?: string | null;
          region?: string | null;
          role?: string | null;
          tax_number?: string | null;
          tax_office?: string | null;
          telefon?: string | null;
          updated_at?: string | null;
          wallet_balance?: number | null;
        };
        Update: {
          ad_soyad?: string | null;
          assistant_clinic_id?: string | null;
          avatar_url?: string | null;
          avg_fuel_consumption?: number | null;
          cart_data?: Json | null;
          city?: string | null;
          company_name?: string | null;
          created_at?: string | null;
          diploma_no?: string | null;
          diploma_uploaded_at?: string | null;
          diploma_url?: string | null;
          discount_rate?: number | null;
          email?: string | null;
          id?: string;
          is_approved?: boolean | null;
          is_dentist?: boolean | null;
          is_verified?: boolean | null;
          klinik_adi?: string | null;
          kvkk_accepted_at?: string | null;
          kvkk_version?: string | null;
          max_rep_discount?: number | null;
          notification_settings?: Json | null;
          plasiyer_id?: string | null;
          region?: string | null;
          role?: string | null;
          tax_number?: string | null;
          tax_office?: string | null;
          telefon?: string | null;
          updated_at?: string | null;
          wallet_balance?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_assistant_clinic_id_fkey';
            columns: ['assistant_clinic_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'profiles_plasiyer_id_fkey';
            columns: ['plasiyer_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      rate_limit_events: {
        Row: {
          blocked: boolean;
          created_at: string;
          endpoint: string;
          hit_count: number;
          id: string;
          ip: string;
          user_agent: string | null;
          user_id: string | null;
          window_ms: number | null;
        };
        Insert: {
          blocked?: boolean;
          created_at?: string;
          endpoint: string;
          hit_count?: number;
          id?: string;
          ip: string;
          user_agent?: string | null;
          user_id?: string | null;
          window_ms?: number | null;
        };
        Update: {
          blocked?: boolean;
          created_at?: string;
          endpoint?: string;
          hit_count?: number;
          id?: string;
          ip?: string;
          user_agent?: string | null;
          user_id?: string | null;
          window_ms?: number | null;
        };
        Relationships: [];
      };
      refresh_tokens: {
        Row: {
          created_at: string | null;
          expires_at: string;
          id: string;
          ip: string | null;
          revoked_at: string | null;
          token_hash: string;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          expires_at: string;
          id?: string;
          ip?: string | null;
          revoked_at?: string | null;
          token_hash: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          expires_at?: string;
          id?: string;
          ip?: string | null;
          revoked_at?: string | null;
          token_hash?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      rep_assignments: {
        Row: {
          client_id: string;
          created_at: string | null;
          id: string;
          rep_id: string;
        };
        Insert: {
          client_id: string;
          created_at?: string | null;
          id?: string;
          rep_id: string;
        };
        Update: {
          client_id?: string;
          created_at?: string | null;
          id?: string;
          rep_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rep_assignments_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rep_assignments_rep_id_fkey';
            columns: ['rep_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      rep_collections: {
        Row: {
          amount: number;
          check_number: string | null;
          client_id: string;
          created_at: string;
          due_date: string | null;
          id: string;
          method: string;
          reference_no: string | null;
          rep_id: string;
          status: string;
          visit_id: string | null;
        };
        Insert: {
          amount: number;
          check_number?: string | null;
          client_id: string;
          created_at?: string;
          due_date?: string | null;
          id?: string;
          method: string;
          reference_no?: string | null;
          rep_id: string;
          status?: string;
          visit_id?: string | null;
        };
        Update: {
          amount?: number;
          check_number?: string | null;
          client_id?: string;
          created_at?: string;
          due_date?: string | null;
          id?: string;
          method?: string;
          reference_no?: string | null;
          rep_id?: string;
          status?: string;
          visit_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'rep_collections_visit_id_fkey';
            columns: ['visit_id'];
            isOneToOne: false;
            referencedRelation: 'rep_visits';
            referencedColumns: ['id'];
          },
        ];
      };
      rep_daily_notes: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          note_date: string;
          rep_id: string;
          updated_at: string;
        };
        Insert: {
          content?: string;
          created_at?: string;
          id?: string;
          note_date?: string;
          rep_id: string;
          updated_at?: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          note_date?: string;
          rep_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      rep_tasks: {
        Row: {
          client_id: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          notes: string | null;
          rep_id: string;
          scheduled_date: string;
          scheduled_time: string | null;
          source_notification_id: string | null;
          status: Database['public']['Enums']['rep_task_status'];
          task_type: Database['public']['Enums']['rep_task_type'];
          title: string;
          updated_at: string;
        };
        Insert: {
          client_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          notes?: string | null;
          rep_id: string;
          scheduled_date?: string;
          scheduled_time?: string | null;
          source_notification_id?: string | null;
          status?: Database['public']['Enums']['rep_task_status'];
          task_type?: Database['public']['Enums']['rep_task_type'];
          title: string;
          updated_at?: string;
        };
        Update: {
          client_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          notes?: string | null;
          rep_id?: string;
          scheduled_date?: string;
          scheduled_time?: string | null;
          source_notification_id?: string | null;
          status?: Database['public']['Enums']['rep_task_status'];
          task_type?: Database['public']['Enums']['rep_task_type'];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rep_tasks_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rep_tasks_source_notification_id_fkey';
            columns: ['source_notification_id'];
            isOneToOne: true;
            referencedRelation: 'notifications';
            referencedColumns: ['id'];
          },
        ];
      };
      rep_visits: {
        Row: {
          check_in_at: string | null;
          check_in_location: unknown;
          check_out_at: string | null;
          client_id: string;
          created_at: string;
          custom_fields: Json;
          follow_up_date: string | null;
          id: string;
          location_lat: number | null;
          location_lng: number | null;
          next_action: string | null;
          next_action_due: string | null;
          notes: string | null;
          outcome: string | null;
          photos: string[];
          rep_id: string;
          route_id: string | null;
          status: string;
          visit_type: string;
        };
        Insert: {
          check_in_at?: string | null;
          check_in_location?: unknown;
          check_out_at?: string | null;
          client_id: string;
          created_at?: string;
          custom_fields?: Json;
          follow_up_date?: string | null;
          id?: string;
          location_lat?: number | null;
          location_lng?: number | null;
          next_action?: string | null;
          next_action_due?: string | null;
          notes?: string | null;
          outcome?: string | null;
          photos?: string[];
          rep_id: string;
          route_id?: string | null;
          status?: string;
          visit_type: string;
        };
        Update: {
          check_in_at?: string | null;
          check_in_location?: unknown;
          check_out_at?: string | null;
          client_id?: string;
          created_at?: string;
          custom_fields?: Json;
          follow_up_date?: string | null;
          id?: string;
          location_lat?: number | null;
          location_lng?: number | null;
          next_action?: string | null;
          next_action_due?: string | null;
          notes?: string | null;
          outcome?: string | null;
          photos?: string[];
          rep_id?: string;
          route_id?: string | null;
          status?: string;
          visit_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rep_visits_route_id_fkey';
            columns: ['route_id'];
            isOneToOne: false;
            referencedRelation: 'saha_routes';
            referencedColumns: ['id'];
          },
        ];
      };
      rma_requests: {
        Row: {
          action: string;
          admin_note: string | null;
          created_at: string;
          description: string | null;
          id: string;
          issue_description: string | null;
          order_id: string;
          order_item_id: string | null;
          photos: Json;
          product_id: string;
          reason: string | null;
          refund_amount: number | null;
          request_type: string;
          serial_number: string | null;
          status: string;
          tracking_code: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          action?: string;
          admin_note?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          issue_description?: string | null;
          order_id: string;
          order_item_id?: string | null;
          photos?: Json;
          product_id: string;
          reason?: string | null;
          refund_amount?: number | null;
          request_type: string;
          serial_number?: string | null;
          status?: string;
          tracking_code: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          action?: string;
          admin_note?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          issue_description?: string | null;
          order_id?: string;
          order_item_id?: string | null;
          photos?: Json;
          product_id?: string;
          reason?: string | null;
          refund_amount?: number | null;
          request_type?: string;
          serial_number?: string | null;
          status?: string;
          tracking_code?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rma_requests_order_item_id_fkey';
            columns: ['order_item_id'];
            isOneToOne: false;
            referencedRelation: 'order_items';
            referencedColumns: ['id'];
          },
        ];
      };
      role_permissions: {
        Row: {
          permission_code: string;
          role: string;
        };
        Insert: {
          permission_code: string;
          role: string;
        };
        Update: {
          permission_code?: string;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'role_permissions_permission_code_fkey';
            columns: ['permission_code'];
            isOneToOne: false;
            referencedRelation: 'permissions';
            referencedColumns: ['code'];
          },
        ];
      };
      saha_account_notes: {
        Row: {
          account_id: string;
          body: string;
          created_at: string;
          id: string;
          rep_id: string;
        };
        Insert: {
          account_id: string;
          body: string;
          created_at?: string;
          id?: string;
          rep_id: string;
        };
        Update: {
          account_id?: string;
          body?: string;
          created_at?: string;
          id?: string;
          rep_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_account_notes_rep_id_fkey';
            columns: ['rep_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_api_usage: {
        Row: {
          endpoint: string;
          id: number;
          queries_count: number;
          request_meta: Json | null;
          used_at: string;
          user_id: string;
        };
        Insert: {
          endpoint: string;
          id?: number;
          queries_count?: number;
          request_meta?: Json | null;
          used_at?: string;
          user_id: string;
        };
        Update: {
          endpoint?: string;
          id?: number;
          queries_count?: number;
          request_meta?: Json | null;
          used_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      saha_assignments: {
        Row: {
          account_id: string;
          assigned_at: string;
          assigned_by: string | null;
          id: string;
          profile_id: string;
          region_districts: string[];
          region_provinces: string[];
        };
        Insert: {
          account_id: string;
          assigned_at?: string;
          assigned_by?: string | null;
          id?: string;
          profile_id: string;
          region_districts?: string[];
          region_provinces?: string[];
        };
        Update: {
          account_id?: string;
          assigned_at?: string;
          assigned_by?: string | null;
          id?: string;
          profile_id?: string;
          region_districts?: string[];
          region_provinces?: string[];
        };
        Relationships: [
          {
            foreignKeyName: 'saha_assignments_assigned_by_fkey';
            columns: ['assigned_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_assignments_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_blacklist: {
        Row: {
          account_id: string;
          banned_until: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          reason: string;
        };
        Insert: {
          account_id: string;
          banned_until?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          reason: string;
        };
        Update: {
          account_id?: string;
          banned_until?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          reason?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_blacklist_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_cariler: {
        Row: {
          account_id: string | null;
          acilis_bakiyesi: number;
          banka_adi: string | null;
          cari_kodu: string;
          clinic_id: string | null;
          created_at: string;
          created_by: string | null;
          durum: string;
          fatura_adresi: string | null;
          fatura_unvani: string;
          iban: string | null;
          id: string;
          il: string | null;
          ilce: string | null;
          kredi_limiti: number;
          notlar: string | null;
          odeme_vadesi_gun: number;
          profile_id: string | null;
          sales_rep_id: string | null;
          updated_at: string;
          vergi_dairesi: string | null;
          vergi_no: string | null;
        };
        Insert: {
          account_id?: string | null;
          acilis_bakiyesi?: number;
          banka_adi?: string | null;
          cari_kodu: string;
          clinic_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          durum?: string;
          fatura_adresi?: string | null;
          fatura_unvani: string;
          iban?: string | null;
          id?: string;
          il?: string | null;
          ilce?: string | null;
          kredi_limiti?: number;
          notlar?: string | null;
          odeme_vadesi_gun?: number;
          profile_id?: string | null;
          sales_rep_id?: string | null;
          updated_at?: string;
          vergi_dairesi?: string | null;
          vergi_no?: string | null;
        };
        Update: {
          account_id?: string | null;
          acilis_bakiyesi?: number;
          banka_adi?: string | null;
          cari_kodu?: string;
          clinic_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          durum?: string;
          fatura_adresi?: string | null;
          fatura_unvani?: string;
          iban?: string | null;
          id?: string;
          il?: string | null;
          ilce?: string | null;
          kredi_limiti?: number;
          notlar?: string | null;
          odeme_vadesi_gun?: number;
          profile_id?: string | null;
          sales_rep_id?: string | null;
          updated_at?: string;
          vergi_dairesi?: string | null;
          vergi_no?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_cariler_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'aging_report';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'saha_cariler_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'customer_accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_cariler_clinic_id_fkey';
            columns: ['clinic_id'];
            isOneToOne: false;
            referencedRelation: 'saha_clinics';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_cariler_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_cariler_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_cariler_sales_rep_id_fkey';
            columns: ['sales_rep_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_cek_senetler: {
        Row: {
          banka: string | null;
          banka_sube: string | null;
          cari_id: string | null;
          cek_no: string | null;
          created_at: string;
          created_by: string | null;
          durum: string;
          id: string;
          karsiliksiz_notu: string | null;
          karsiliksiz_tarihi: string | null;
          kesideci: string;
          kesideci_vkn: string | null;
          notlar: string | null;
          tahsil_tarihi: string | null;
          tahsile_verildi_banka: string | null;
          tahsile_verildi_tarih: string | null;
          tip: string;
          tutar: number;
          updated_at: string;
          vade_tarihi: string;
        };
        Insert: {
          banka?: string | null;
          banka_sube?: string | null;
          cari_id?: string | null;
          cek_no?: string | null;
          created_at?: string;
          created_by?: string | null;
          durum?: string;
          id?: string;
          karsiliksiz_notu?: string | null;
          karsiliksiz_tarihi?: string | null;
          kesideci: string;
          kesideci_vkn?: string | null;
          notlar?: string | null;
          tahsil_tarihi?: string | null;
          tahsile_verildi_banka?: string | null;
          tahsile_verildi_tarih?: string | null;
          tip?: string;
          tutar: number;
          updated_at?: string;
          vade_tarihi: string;
        };
        Update: {
          banka?: string | null;
          banka_sube?: string | null;
          cari_id?: string | null;
          cek_no?: string | null;
          created_at?: string;
          created_by?: string | null;
          durum?: string;
          id?: string;
          karsiliksiz_notu?: string | null;
          karsiliksiz_tarihi?: string | null;
          kesideci?: string;
          kesideci_vkn?: string | null;
          notlar?: string | null;
          tahsil_tarihi?: string | null;
          tahsile_verildi_banka?: string | null;
          tahsile_verildi_tarih?: string | null;
          tip?: string;
          tutar?: number;
          updated_at?: string;
          vade_tarihi?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_cek_senetler_cari_id_fkey';
            columns: ['cari_id'];
            isOneToOne: false;
            referencedRelation: 'saha_cariler';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_cek_senetler_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_clinic_edit_logs: {
        Row: {
          action: string;
          after: Json | null;
          before: Json | null;
          clinic_id: string | null;
          edited_at: string;
          edited_by: string | null;
          id: string;
        };
        Insert: {
          action: string;
          after?: Json | null;
          before?: Json | null;
          clinic_id?: string | null;
          edited_at?: string;
          edited_by?: string | null;
          id?: string;
        };
        Update: {
          action?: string;
          after?: Json | null;
          before?: Json | null;
          clinic_id?: string | null;
          edited_at?: string;
          edited_by?: string | null;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_clinic_edit_logs_clinic_id_fkey';
            columns: ['clinic_id'];
            isOneToOne: false;
            referencedRelation: 'saha_clinics';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_clinic_edit_logs_edited_by_fkey';
            columns: ['edited_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_clinic_scan_logs: {
        Row: {
          district_slug: string | null;
          id: string;
          lat: number;
          lng: number;
          performed_at: string;
          performed_by: string | null;
          province_slug: string;
          radius_m: number;
          result_summary: Json;
          scan_mode: string;
          source: string;
        };
        Insert: {
          district_slug?: string | null;
          id?: string;
          lat: number;
          lng: number;
          performed_at?: string;
          performed_by?: string | null;
          province_slug: string;
          radius_m: number;
          result_summary?: Json;
          scan_mode?: string;
          source?: string;
        };
        Update: {
          district_slug?: string | null;
          id?: string;
          lat?: number;
          lng?: number;
          performed_at?: string;
          performed_by?: string | null;
          province_slug?: string;
          radius_m?: number;
          result_summary?: Json;
          scan_mode?: string;
          source?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_clinic_scan_logs_performed_by_fkey';
            columns: ['performed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_clinics: {
        Row: {
          address: string | null;
          clinic_segment: string;
          created_at: string;
          district_slug: string | null;
          first_seen_at: string;
          google_place_id: string | null;
          id: string;
          last_seen_at: string;
          last_verified_at: string | null;
          lat: number;
          lng: number;
          location: unknown;
          name: string;
          osm_id: string | null;
          phone: string | null;
          province_slug: string | null;
          rating: number | null;
          raw_payload: Json | null;
          sources: string[];
          status: string;
          types: string[];
          updated_at: string;
          user_ratings_total: number | null;
          vertical_key: string;
          website: string | null;
          potential: number | null;
          potential_at: string | null;
          first_contact_at: string | null;
        };
        Insert: {
          address?: string | null;
          clinic_segment?: string;
          created_at?: string;
          district_slug?: string | null;
          first_seen_at?: string;
          google_place_id?: string | null;
          id?: string;
          last_seen_at?: string;
          last_verified_at?: string | null;
          lat: number;
          lng: number;
          location?: unknown;
          name: string;
          osm_id?: string | null;
          phone?: string | null;
          province_slug?: string | null;
          rating?: number | null;
          raw_payload?: Json | null;
          sources?: string[];
          status?: string;
          types?: string[];
          updated_at?: string;
          user_ratings_total?: number | null;
          vertical_key?: string;
          website?: string | null;
          potential?: number | null;
          potential_at?: string | null;
          first_contact_at?: string | null;
        };
        Update: {
          address?: string | null;
          clinic_segment?: string;
          created_at?: string;
          district_slug?: string | null;
          first_seen_at?: string;
          google_place_id?: string | null;
          id?: string;
          last_seen_at?: string;
          last_verified_at?: string | null;
          lat?: number;
          lng?: number;
          location?: unknown;
          name?: string;
          osm_id?: string | null;
          phone?: string | null;
          province_slug?: string | null;
          rating?: number | null;
          raw_payload?: Json | null;
          sources?: string[];
          status?: string;
          types?: string[];
          updated_at?: string;
          user_ratings_total?: number | null;
          vertical_key?: string;
          website?: string | null;
          potential?: number | null;
          potential_at?: string | null;
          first_contact_at?: string | null;
        };
        Relationships: [];
      };
      saha_fatura_kalemleri: {
        Row: {
          birim: string;
          birim_fiyat: number;
          created_at: string;
          fatura_id: string;
          id: string;
          iskonto_orani: number;
          kdv_orani: number;
          kdv_tutari: number | null;
          miktar: number;
          net_tutar: number | null;
          satir_toplam: number | null;
          sira: number;
          urun_adi: string;
          urun_id: string | null;
        };
        Insert: {
          birim?: string;
          birim_fiyat: number;
          created_at?: string;
          fatura_id: string;
          id?: string;
          iskonto_orani?: number;
          kdv_orani?: number;
          kdv_tutari?: number | null;
          miktar: number;
          net_tutar?: number | null;
          satir_toplam?: number | null;
          sira?: number;
          urun_adi: string;
          urun_id?: string | null;
        };
        Update: {
          birim?: string;
          birim_fiyat?: number;
          created_at?: string;
          fatura_id?: string;
          id?: string;
          iskonto_orani?: number;
          kdv_orani?: number;
          kdv_tutari?: number | null;
          miktar?: number;
          net_tutar?: number | null;
          satir_toplam?: number | null;
          sira?: number;
          urun_adi?: string;
          urun_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_fatura_kalemleri_fatura_id_fkey';
            columns: ['fatura_id'];
            isOneToOne: false;
            referencedRelation: 'saha_faturalar';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_fatura_kalemleri_urun_id_fkey';
            columns: ['urun_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_faturalar: {
        Row: {
          aciklama: string | null;
          ara_toplam: number;
          cari_id: string;
          created_at: string;
          created_by: string | null;
          durum: string;
          efatura_durum: string | null;
          efatura_uuid: string | null;
          fatura_no: string | null;
          faturasiz: boolean;
          id: string;
          iskonto_toplam: number;
          kalan: number | null;
          kdv_tutari: number;
          odenen: number;
          order_id: string | null;
          para_birimi: string;
          tarih: string;
          tip: string;
          toplam: number;
          updated_at: string;
          vade_tarihi: string | null;
        };
        Insert: {
          aciklama?: string | null;
          ara_toplam?: number;
          cari_id: string;
          created_at?: string;
          created_by?: string | null;
          durum?: string;
          efatura_durum?: string | null;
          efatura_uuid?: string | null;
          fatura_no?: string | null;
          faturasiz?: boolean;
          id?: string;
          iskonto_toplam?: number;
          kalan?: number | null;
          kdv_tutari?: number;
          odenen?: number;
          order_id?: string | null;
          para_birimi?: string;
          tarih?: string;
          tip?: string;
          toplam?: number;
          updated_at?: string;
          vade_tarihi?: string | null;
        };
        Update: {
          aciklama?: string | null;
          ara_toplam?: number;
          cari_id?: string;
          created_at?: string;
          created_by?: string | null;
          durum?: string;
          efatura_durum?: string | null;
          efatura_uuid?: string | null;
          fatura_no?: string | null;
          faturasiz?: boolean;
          id?: string;
          iskonto_toplam?: number;
          kalan?: number | null;
          kdv_tutari?: number;
          odenen?: number;
          order_id?: string | null;
          para_birimi?: string;
          tarih?: string;
          tip?: string;
          toplam?: number;
          updated_at?: string;
          vade_tarihi?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_faturalar_cari_id_fkey';
            columns: ['cari_id'];
            isOneToOne: false;
            referencedRelation: 'saha_cariler';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_faturalar_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_faturalar_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_invoice_requests: {
        Row: {
          created_at: string;
          id: string;
          note: string | null;
          order_id: string;
          requested_by: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          note?: string | null;
          order_id: string;
          requested_by?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          note?: string | null;
          order_id?: string;
          requested_by?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_invoice_requests_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: true;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_invoice_requests_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_mileage_logs: {
        Row: {
          created_at: string;
          distance_km: number;
          duration_min: number | null;
          estimated_fuel_cost: number | null;
          estimated_fuel_l: number | null;
          id: string;
          log_date: string;
          profile_id: string;
          route_id: string | null;
        };
        Insert: {
          created_at?: string;
          distance_km: number;
          duration_min?: number | null;
          estimated_fuel_cost?: number | null;
          estimated_fuel_l?: number | null;
          id?: string;
          log_date?: string;
          profile_id: string;
          route_id?: string | null;
        };
        Update: {
          created_at?: string;
          distance_km?: number;
          duration_min?: number | null;
          estimated_fuel_cost?: number | null;
          estimated_fuel_l?: number | null;
          id?: string;
          log_date?: string;
          profile_id?: string;
          route_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_mileage_logs_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_mileage_logs_route_id_fkey';
            columns: ['route_id'];
            isOneToOne: false;
            referencedRelation: 'saha_routes';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_neighborhoods: {
        Row: {
          district_slug: string;
          fetched_at: string;
          id: string;
          lat: number | null;
          lng: number | null;
          name: string;
          province_slug: string;
          source: string;
        };
        Insert: {
          district_slug: string;
          fetched_at?: string;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          name: string;
          province_slug: string;
          source?: string;
        };
        Update: {
          district_slug?: string;
          fetched_at?: string;
          id?: string;
          lat?: number | null;
          lng?: number | null;
          name?: string;
          province_slug?: string;
          source?: string;
        };
        Relationships: [];
      };
      saha_notifications: {
        Row: {
          body: string | null;
          created_at: string;
          id: string;
          payload: Json;
          read_at: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          id?: string;
          payload?: Json;
          read_at?: string | null;
          title: string;
          type: string;
          user_id: string;
        };
        Update: {
          body?: string | null;
          created_at?: string;
          id?: string;
          payload?: Json;
          read_at?: string | null;
          title?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      saha_odemeler: {
        Row: {
          aciklama: string | null;
          cari_id: string;
          cek_senet_id: string | null;
          created_at: string;
          created_by: string | null;
          dekont_no: string | null;
          fatura_id: string | null;
          id: string;
          tarih: string;
          tutar: number;
          updated_at: string;
          yontem: string;
        };
        Insert: {
          aciklama?: string | null;
          cari_id: string;
          cek_senet_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          dekont_no?: string | null;
          fatura_id?: string | null;
          id?: string;
          tarih?: string;
          tutar: number;
          updated_at?: string;
          yontem?: string;
        };
        Update: {
          aciklama?: string | null;
          cari_id?: string;
          cek_senet_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          dekont_no?: string | null;
          fatura_id?: string | null;
          id?: string;
          tarih?: string;
          tutar?: number;
          updated_at?: string;
          yontem?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_odemeler_cari_id_fkey';
            columns: ['cari_id'];
            isOneToOne: false;
            referencedRelation: 'saha_cariler';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_odemeler_cek_senet_fkey';
            columns: ['cek_senet_id'];
            isOneToOne: false;
            referencedRelation: 'saha_cek_senetler';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_odemeler_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_odemeler_fatura_id_fkey';
            columns: ['fatura_id'];
            isOneToOne: false;
            referencedRelation: 'saha_faturalar';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_order_templates: {
        Row: {
          clinic_id: string | null;
          created_at: string;
          id: string;
          lines: Json;
          name: string;
          rep_id: string;
          updated_at: string;
        };
        Insert: {
          clinic_id?: string | null;
          created_at?: string;
          id?: string;
          lines?: Json;
          name: string;
          rep_id: string;
          updated_at?: string;
        };
        Update: {
          clinic_id?: string | null;
          created_at?: string;
          id?: string;
          lines?: Json;
          name?: string;
          rep_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_order_templates_rep_id_fkey';
            columns: ['rep_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_rep_targets: {
        Row: {
          collection_target_tl: number | null;
          created_at: string;
          id: string;
          order_target_tl: number | null;
          rep_id: string;
          visit_target: number | null;
          year_month: string;
        };
        Insert: {
          collection_target_tl?: number | null;
          created_at?: string;
          id?: string;
          order_target_tl?: number | null;
          rep_id: string;
          visit_target?: number | null;
          year_month: string;
        };
        Update: {
          collection_target_tl?: number | null;
          created_at?: string;
          id?: string;
          order_target_tl?: number | null;
          rep_id?: string;
          visit_target?: number | null;
          year_month?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_rep_targets_rep_id_fkey';
            columns: ['rep_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_routes: {
        Row: {
          accepted_at: string | null;
          account_ids: string[];
          assigned_at: string | null;
          assigned_by: string | null;
          assigned_to: string | null;
          assignment_note: string | null;
          completed_at: string | null;
          created_at: string;
          id: string;
          is_recurring: boolean;
          name: string | null;
          optimized: boolean;
          profile_id: string;
          recurrence_rule: string | null;
          started_at: string | null;
          status: string;
          total_distance_km: number | null;
          total_duration_min: number | null;
          updated_at: string;
        };
        Insert: {
          accepted_at?: string | null;
          account_ids: string[];
          assigned_at?: string | null;
          assigned_by?: string | null;
          assigned_to?: string | null;
          assignment_note?: string | null;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          is_recurring?: boolean;
          name?: string | null;
          optimized?: boolean;
          profile_id: string;
          recurrence_rule?: string | null;
          started_at?: string | null;
          status?: string;
          total_distance_km?: number | null;
          total_duration_min?: number | null;
          updated_at?: string;
        };
        Update: {
          accepted_at?: string | null;
          account_ids?: string[];
          assigned_at?: string | null;
          assigned_by?: string | null;
          assigned_to?: string | null;
          assignment_note?: string | null;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          is_recurring?: boolean;
          name?: string | null;
          optimized?: boolean;
          profile_id?: string;
          recurrence_rule?: string | null;
          started_at?: string | null;
          status?: string;
          total_distance_km?: number | null;
          total_duration_min?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_routes_assigned_by_fkey';
            columns: ['assigned_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_routes_assigned_to_fkey';
            columns: ['assigned_to'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_routes_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_sample_lines: {
        Row: {
          created_at: string;
          id: string;
          product_id: string | null;
          product_name: string;
          qty: number;
          sample_id: string;
          unit: string;
          unit_cost_tl: number | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          product_id?: string | null;
          product_name: string;
          qty: number;
          sample_id: string;
          unit?: string;
          unit_cost_tl?: number | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          product_id?: string | null;
          product_name?: string;
          qty?: number;
          sample_id?: string;
          unit?: string;
          unit_cost_tl?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_sample_lines_sample_id_fkey';
            columns: ['sample_id'];
            isOneToOne: false;
            referencedRelation: 'saha_samples';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_sample_policies: {
        Row: {
          cooldown_days: number;
          created_at: string;
          created_by: string | null;
          id: string;
          max_per_account_yearly: number;
          min_conversion_pct: number;
          product_category_key: string;
          updated_at: string;
          vertical_key: string;
        };
        Insert: {
          cooldown_days?: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          max_per_account_yearly?: number;
          min_conversion_pct?: number;
          product_category_key: string;
          updated_at?: string;
          vertical_key: string;
        };
        Update: {
          cooldown_days?: number;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          max_per_account_yearly?: number;
          min_conversion_pct?: number;
          product_category_key?: string;
          updated_at?: string;
          vertical_key?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_sample_policies_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_sample_quotas: {
        Row: {
          budget_tl: number;
          created_at: string;
          id: string;
          notes: string | null;
          rep_id: string;
          spent_tl: number;
          updated_at: string;
          year_month: string;
        };
        Insert: {
          budget_tl?: number;
          created_at?: string;
          id?: string;
          notes?: string | null;
          rep_id: string;
          spent_tl?: number;
          updated_at?: string;
          year_month: string;
        };
        Update: {
          budget_tl?: number;
          created_at?: string;
          id?: string;
          notes?: string | null;
          rep_id?: string;
          spent_tl?: number;
          updated_at?: string;
          year_month?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_sample_quotas_rep_id_fkey';
            columns: ['rep_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_samples: {
        Row: {
          account_id: string;
          converted_order_id: string | null;
          created_at: string;
          follow_up_at: string;
          given_at: string;
          id: string;
          kvkk_consent_version: string;
          notes: string | null;
          photo_url: string | null;
          rep_id: string;
          signature_url: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          account_id: string;
          converted_order_id?: string | null;
          created_at?: string;
          follow_up_at: string;
          given_at?: string;
          id?: string;
          kvkk_consent_version: string;
          notes?: string | null;
          photo_url?: string | null;
          rep_id: string;
          signature_url?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          account_id?: string;
          converted_order_id?: string | null;
          created_at?: string;
          follow_up_at?: string;
          given_at?: string;
          id?: string;
          kvkk_consent_version?: string;
          notes?: string | null;
          photo_url?: string | null;
          rep_id?: string;
          signature_url?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_samples_rep_id_fkey';
            columns: ['rep_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_scan_budget_config: {
        Row: {
          daily_query_limit: number;
          id: number;
          updated_at: string;
          updated_by: string | null;
          whole_country_max_ok: boolean;
        };
        Insert: {
          daily_query_limit?: number;
          id?: number;
          updated_at?: string;
          updated_by?: string | null;
          whole_country_max_ok?: boolean;
        };
        Update: {
          daily_query_limit?: number;
          id?: number;
          updated_at?: string;
          updated_by?: string | null;
          whole_country_max_ok?: boolean;
        };
        Relationships: [];
      };
      saha_scan_job_items: {
        Row: {
          completed_at: string | null;
          created_at: string;
          district_slug: string | null;
          error_message: string | null;
          filtered_out_count: number;
          google_count: number | null;
          id: string;
          job_id: string;
          lat: number;
          lng: number;
          new_count: number;
          osm_count: number | null;
          province_slug: string;
          scanned_count: number;
          started_at: string | null;
          status: string;
          updated_count: number;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          district_slug?: string | null;
          error_message?: string | null;
          filtered_out_count?: number;
          google_count?: number | null;
          id?: string;
          job_id: string;
          lat: number;
          lng: number;
          new_count?: number;
          osm_count?: number | null;
          province_slug: string;
          scanned_count?: number;
          started_at?: string | null;
          status?: string;
          updated_count?: number;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          district_slug?: string | null;
          error_message?: string | null;
          filtered_out_count?: number;
          google_count?: number | null;
          id?: string;
          job_id?: string;
          lat?: number;
          lng?: number;
          new_count?: number;
          osm_count?: number | null;
          province_slug?: string;
          scanned_count?: number;
          started_at?: string | null;
          status?: string;
          updated_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_scan_job_items_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'saha_scan_jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_scan_jobs: {
        Row: {
          completed_at: string | null;
          completed_items: number;
          created_at: string;
          created_by: string | null;
          failed_items: number;
          id: string;
          last_error: string | null;
          radius_km: number;
          scan_intensity: string;
          scan_source: string;
          scan_types: string[];
          scope_params: Json;
          scope_type: string;
          started_at: string | null;
          status: string;
          total_clinics_found: number;
          total_items: number;
          total_new_clinics: number;
          updated_at: string;
          vertical_key: string;
        };
        Insert: {
          completed_at?: string | null;
          completed_items?: number;
          created_at?: string;
          created_by?: string | null;
          failed_items?: number;
          id?: string;
          last_error?: string | null;
          radius_km?: number;
          scan_intensity?: string;
          scan_source?: string;
          scan_types?: string[];
          scope_params?: Json;
          scope_type: string;
          started_at?: string | null;
          status?: string;
          total_clinics_found?: number;
          total_items?: number;
          total_new_clinics?: number;
          updated_at?: string;
          vertical_key?: string;
        };
        Update: {
          completed_at?: string | null;
          completed_items?: number;
          created_at?: string;
          created_by?: string | null;
          failed_items?: number;
          id?: string;
          last_error?: string | null;
          radius_km?: number;
          scan_intensity?: string;
          scan_source?: string;
          scan_types?: string[];
          scope_params?: Json;
          scope_type?: string;
          started_at?: string | null;
          status?: string;
          total_clinics_found?: number;
          total_items?: number;
          total_new_clinics?: number;
          updated_at?: string;
          vertical_key?: string;
        };
        Relationships: [];
      };
      saha_sync_queue: {
        Row: {
          created_at: string;
          error_message: string | null;
          id: string;
          operation_type: string;
          payload: Json;
          processed_at: string | null;
          profile_id: string;
          retry_count: number;
          status: string;
        };
        Insert: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          operation_type: string;
          payload: Json;
          processed_at?: string | null;
          profile_id: string;
          retry_count?: number;
          status?: string;
        };
        Update: {
          created_at?: string;
          error_message?: string | null;
          id?: string;
          operation_type?: string;
          payload?: Json;
          processed_at?: string | null;
          profile_id?: string;
          retry_count?: number;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_sync_queue_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_visit_photos: {
        Row: {
          category: string;
          created_at: string;
          id: string;
          storage_path: string;
          visit_id: string;
        };
        Insert: {
          category?: string;
          created_at?: string;
          id?: string;
          storage_path: string;
          visit_id: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          id?: string;
          storage_path?: string;
          visit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_visit_photos_visit_id_fkey';
            columns: ['visit_id'];
            isOneToOne: false;
            referencedRelation: 'saha_visits';
            referencedColumns: ['id'];
          },
        ];
      };
      saha_visits: {
        Row: {
          account_id: string;
          check_in_accuracy_m: number | null;
          check_in_at: string;
          check_in_lat: number | null;
          check_in_lng: number | null;
          check_out_at: string | null;
          created_at: string;
          custom_fields: Json;
          distance_to_account_m: number | null;
          id: string;
          met_person: string | null;
          next_visit_date: string | null;
          notes: string | null;
          outcome: string | null;
          rep_id: string;
          route_id: string | null;
          status: string;
          updated_at: string;
          potential: number | null;
        };
        Insert: {
          account_id: string;
          check_in_accuracy_m?: number | null;
          check_in_at?: string;
          check_in_lat?: number | null;
          check_in_lng?: number | null;
          check_out_at?: string | null;
          created_at?: string;
          custom_fields?: Json;
          distance_to_account_m?: number | null;
          id?: string;
          met_person?: string | null;
          next_visit_date?: string | null;
          notes?: string | null;
          outcome?: string | null;
          rep_id: string;
          route_id?: string | null;
          status?: string;
          updated_at?: string;
          potential?: number | null;
        };
        Update: {
          account_id?: string;
          check_in_accuracy_m?: number | null;
          check_in_at?: string;
          check_in_lat?: number | null;
          check_in_lng?: number | null;
          check_out_at?: string | null;
          created_at?: string;
          custom_fields?: Json;
          distance_to_account_m?: number | null;
          id?: string;
          met_person?: string | null;
          next_visit_date?: string | null;
          notes?: string | null;
          outcome?: string | null;
          rep_id?: string;
          route_id?: string | null;
          status?: string;
          updated_at?: string;
          potential?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'saha_visits_rep_id_fkey';
            columns: ['rep_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'saha_visits_route_id_fkey';
            columns: ['route_id'];
            isOneToOne: false;
            referencedRelation: 'saha_routes';
            referencedColumns: ['id'];
          },
        ];
      };
      sample_request_logs: {
        Row: {
          changed_by: string | null;
          created_at: string;
          id: string;
          new_status: string;
          notes: string | null;
          old_status: string | null;
          sample_request_id: string;
        };
        Insert: {
          changed_by?: string | null;
          created_at?: string;
          id?: string;
          new_status: string;
          notes?: string | null;
          old_status?: string | null;
          sample_request_id: string;
        };
        Update: {
          changed_by?: string | null;
          created_at?: string;
          id?: string;
          new_status?: string;
          notes?: string | null;
          old_status?: string | null;
          sample_request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'sample_request_logs_changed_by_fkey';
            columns: ['changed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sample_request_logs_sample_request_id_fkey';
            columns: ['sample_request_id'];
            isOneToOne: false;
            referencedRelation: 'sample_requests';
            referencedColumns: ['id'];
          },
        ];
      };
      sample_requests: {
        Row: {
          admin_notes: string | null;
          approved_at: string | null;
          approved_by: string | null;
          clinic_id: string | null;
          created_at: string;
          delivered_at: string | null;
          doctor_notes: string | null;
          id: string;
          product_id: string;
          quantity: number;
          rejection_reason: string | null;
          requested_at: string;
          sample_price: number | null;
          shipped_at: string | null;
          shipping_fee: number | null;
          status: string | null;
          total_amount: number | null;
          tracking_number: string | null;
          updated_at: string;
          user_id: string;
          variant_id: string | null;
        };
        Insert: {
          admin_notes?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          clinic_id?: string | null;
          created_at?: string;
          delivered_at?: string | null;
          doctor_notes?: string | null;
          id?: string;
          product_id: string;
          quantity?: number;
          rejection_reason?: string | null;
          requested_at?: string;
          sample_price?: number | null;
          shipped_at?: string | null;
          shipping_fee?: number | null;
          status?: string | null;
          total_amount?: number | null;
          tracking_number?: string | null;
          updated_at?: string;
          user_id: string;
          variant_id?: string | null;
        };
        Update: {
          admin_notes?: string | null;
          approved_at?: string | null;
          approved_by?: string | null;
          clinic_id?: string | null;
          created_at?: string;
          delivered_at?: string | null;
          doctor_notes?: string | null;
          id?: string;
          product_id?: string;
          quantity?: number;
          rejection_reason?: string | null;
          requested_at?: string;
          sample_price?: number | null;
          shipped_at?: string | null;
          shipping_fee?: number | null;
          status?: string | null;
          total_amount?: number | null;
          tracking_number?: string | null;
          updated_at?: string;
          user_id?: string;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'sample_requests_approved_by_fkey';
            columns: ['approved_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sample_requests_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sample_requests_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sample_requests_variant_id_fkey';
            columns: ['variant_id'];
            isOneToOne: false;
            referencedRelation: 'variant_combinations';
            referencedColumns: ['id'];
          },
        ];
      };
      scheduled_notifications: {
        Row: {
          created_at: string;
          created_by: string | null;
          data: Json | null;
          error_message: string | null;
          id: string;
          message: string;
          scheduled_at: string;
          sent_at: string | null;
          status: string;
          target: string;
          title: string;
          type: string;
          user_ids: string[] | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          data?: Json | null;
          error_message?: string | null;
          id?: string;
          message: string;
          scheduled_at: string;
          sent_at?: string | null;
          status?: string;
          target?: string;
          title: string;
          type?: string;
          user_ids?: string[] | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          data?: Json | null;
          error_message?: string | null;
          id?: string;
          message?: string;
          scheduled_at?: string;
          sent_at?: string | null;
          status?: string;
          target?: string;
          title?: string;
          type?: string;
          user_ids?: string[] | null;
        };
        Relationships: [];
      };
      search_analytics: {
        Row: {
          clicked_product_id: string | null;
          id: string;
          query: string;
          results_count: number | null;
          timestamp: string;
          user_id: string | null;
        };
        Insert: {
          clicked_product_id?: string | null;
          id?: string;
          query: string;
          results_count?: number | null;
          timestamp?: string;
          user_id?: string | null;
        };
        Update: {
          clicked_product_id?: string | null;
          id?: string;
          query?: string;
          results_count?: number | null;
          timestamp?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      search_log: {
        Row: {
          created_at: string;
          id: string;
          query: string;
          results_count: number;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          query: string;
          results_count?: number;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          query?: string;
          results_count?: number;
          user_id?: string | null;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          category: string;
          key: string;
          updated_at: string | null;
          updated_by: string | null;
          value: Json;
        };
        Insert: {
          category?: string;
          key: string;
          updated_at?: string | null;
          updated_by?: string | null;
          value: Json;
        };
        Update: {
          category?: string;
          key?: string;
          updated_at?: string | null;
          updated_by?: string | null;
          value?: Json;
        };
        Relationships: [
          {
            foreignKeyName: 'settings_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      shipment_items: {
        Row: {
          created_at: string;
          id: string;
          order_item_id: string;
          quantity: number;
          shipment_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          order_item_id: string;
          quantity: number;
          shipment_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          order_item_id?: string;
          quantity?: number;
          shipment_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'shipment_items_order_item_id_fkey';
            columns: ['order_item_id'];
            isOneToOne: false;
            referencedRelation: 'order_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'shipment_items_shipment_id_fkey';
            columns: ['shipment_id'];
            isOneToOne: false;
            referencedRelation: 'order_shipments';
            referencedColumns: ['id'];
          },
        ];
      };
      spatial_ref_sys: {
        Row: {
          auth_name: string | null;
          auth_srid: number | null;
          proj4text: string | null;
          srid: number;
          srtext: string | null;
        };
        Insert: {
          auth_name?: string | null;
          auth_srid?: number | null;
          proj4text?: string | null;
          srid: number;
          srtext?: string | null;
        };
        Update: {
          auth_name?: string | null;
          auth_srid?: number | null;
          proj4text?: string | null;
          srid?: number;
          srtext?: string | null;
        };
        Relationships: [];
      };
      staff_accounts: {
        Row: {
          clinic_id: string | null;
          created_at: string;
          email: string | null;
          id: string;
          locked_until: number | null;
          login_attempts: number;
          name: string | null;
          password_hash: string;
          phone: string | null;
          refresh_tokens: Json;
          role: string;
          two_fa_enabled: boolean;
          updated_at: string;
        };
        Insert: {
          clinic_id?: string | null;
          created_at?: string;
          email?: string | null;
          id: string;
          locked_until?: number | null;
          login_attempts?: number;
          name?: string | null;
          password_hash: string;
          phone?: string | null;
          refresh_tokens?: Json;
          role: string;
          two_fa_enabled?: boolean;
          updated_at?: string;
        };
        Update: {
          clinic_id?: string | null;
          created_at?: string;
          email?: string | null;
          id?: string;
          locked_until?: number | null;
          login_attempts?: number;
          name?: string | null;
          password_hash?: string;
          phone?: string | null;
          refresh_tokens?: Json;
          role?: string;
          two_fa_enabled?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      stock_alerts: {
        Row: {
          created_at: string | null;
          email: string;
          id: string;
          notified: boolean | null;
          product_id: string;
          variant_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          email: string;
          id?: string;
          notified?: boolean | null;
          product_id: string;
          variant_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          email?: string;
          id?: string;
          notified?: boolean | null;
          product_id?: string;
          variant_id?: string | null;
        };
        Relationships: [];
      };
      stock_movements: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          note: string | null;
          product_id: string;
          quantity: number;
          reference_id: string | null;
          type: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          note?: string | null;
          product_id: string;
          quantity: number;
          reference_id?: string | null;
          type: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          note?: string | null;
          product_id?: string;
          quantity?: number;
          reference_id?: string | null;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'stock_movements_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_movements_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      stock_notifications: {
        Row: {
          created_at: string;
          id: string;
          notified: boolean;
          notified_at: string | null;
          product_id: string;
          user_id: string;
          variant_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          notified?: boolean;
          notified_at?: string | null;
          product_id: string;
          user_id: string;
          variant_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          notified?: boolean;
          notified_at?: string | null;
          product_id?: string;
          user_id?: string;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'stock_notifications_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      stock_reservations: {
        Row: {
          converted_to_order_id: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          product_id: string | null;
          quantity: number;
          session_id: string;
          status: string | null;
          user_email: string | null;
          user_id: string | null;
          variant_id: string | null;
        };
        Insert: {
          converted_to_order_id?: string | null;
          created_at?: string;
          expires_at: string;
          id?: string;
          product_id?: string | null;
          quantity: number;
          session_id: string;
          status?: string | null;
          user_email?: string | null;
          user_id?: string | null;
          variant_id?: string | null;
        };
        Update: {
          converted_to_order_id?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          product_id?: string | null;
          quantity?: number;
          session_id?: string;
          status?: string | null;
          user_email?: string | null;
          user_id?: string | null;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'stock_reservations_converted_to_order_id_fkey';
            columns: ['converted_to_order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_reservations_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_reservations_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'stock_reservations_variant_id_fkey';
            columns: ['variant_id'];
            isOneToOne: false;
            referencedRelation: 'variant_combinations';
            referencedColumns: ['id'];
          },
        ];
      };
      subcategories: {
        Row: {
          category_id: string | null;
          description: string | null;
          id: string;
          name: string;
          slug: string;
        };
        Insert: {
          category_id?: string | null;
          description?: string | null;
          id?: string;
          name: string;
          slug: string;
        };
        Update: {
          category_id?: string | null;
          description?: string | null;
          id?: string;
          name?: string;
          slug?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'subcategories_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['id'];
          },
        ];
      };
      system_settings: {
        Row: {
          key: string;
          updated_at: string;
          updated_by: string | null;
          value: Json;
        };
        Insert: {
          key: string;
          updated_at?: string;
          updated_by?: string | null;
          value: Json;
        };
        Update: {
          key?: string;
          updated_at?: string;
          updated_by?: string | null;
          value?: Json;
        };
        Relationships: [];
      };
      technical_specs: {
        Row: {
          display_order: number | null;
          id: string;
          parameter_name: string;
          parameter_value: string;
          product_id: string | null;
          unit: string | null;
        };
        Insert: {
          display_order?: number | null;
          id?: string;
          parameter_name: string;
          parameter_value: string;
          product_id?: string | null;
          unit?: string | null;
        };
        Update: {
          display_order?: number | null;
          id?: string;
          parameter_name?: string;
          parameter_value?: string;
          product_id?: string | null;
          unit?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'technical_specs_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      user_permissions: {
        Row: {
          effect: string;
          granted_at: string | null;
          granted_by: string | null;
          permission_code: string;
          user_id: string;
        };
        Insert: {
          effect: string;
          granted_at?: string | null;
          granted_by?: string | null;
          permission_code: string;
          user_id: string;
        };
        Update: {
          effect?: string;
          granted_at?: string | null;
          granted_by?: string | null;
          permission_code?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_permissions_permission_code_fkey';
            columns: ['permission_code'];
            isOneToOne: false;
            referencedRelation: 'permissions';
            referencedColumns: ['code'];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_roles_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      user_sessions: {
        Row: {
          country: string | null;
          created_at: string | null;
          device_label: string | null;
          id: string;
          ip: string | null;
          last_seen_at: string | null;
          refresh_token_id: string | null;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          country?: string | null;
          created_at?: string | null;
          device_label?: string | null;
          id?: string;
          ip?: string | null;
          last_seen_at?: string | null;
          refresh_token_id?: string | null;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          country?: string | null;
          created_at?: string | null;
          device_label?: string | null;
          id?: string;
          ip?: string | null;
          last_seen_at?: string | null;
          refresh_token_id?: string | null;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_sessions_refresh_token_id_fkey';
            columns: ['refresh_token_id'];
            isOneToOne: true;
            referencedRelation: 'refresh_tokens';
            referencedColumns: ['id'];
          },
        ];
      };
      uts_records: {
        Row: {
          created_at: string;
          expiration_date: string | null;
          id: string;
          lot_number: string | null;
          order_id: string | null;
          order_item_id: string | null;
          product_id: string | null;
          production_date: string | null;
          quantity: number;
          recall_reason: string | null;
          remaining_quantity: number;
          serial_number: string | null;
          status: string;
          updated_at: string;
          uts_product_code: string | null;
          warehouse_location: string | null;
        };
        Insert: {
          created_at?: string;
          expiration_date?: string | null;
          id?: string;
          lot_number?: string | null;
          order_id?: string | null;
          order_item_id?: string | null;
          product_id?: string | null;
          production_date?: string | null;
          quantity: number;
          recall_reason?: string | null;
          remaining_quantity: number;
          serial_number?: string | null;
          status?: string;
          updated_at?: string;
          uts_product_code?: string | null;
          warehouse_location?: string | null;
        };
        Update: {
          created_at?: string;
          expiration_date?: string | null;
          id?: string;
          lot_number?: string | null;
          order_id?: string | null;
          order_item_id?: string | null;
          product_id?: string | null;
          production_date?: string | null;
          quantity?: number;
          recall_reason?: string | null;
          remaining_quantity?: number;
          serial_number?: string | null;
          status?: string;
          updated_at?: string;
          uts_product_code?: string | null;
          warehouse_location?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'uts_records_order_id_fkey';
            columns: ['order_id'];
            isOneToOne: false;
            referencedRelation: 'orders';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'uts_records_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      variant_combinations: {
        Row: {
          allow_backorder: boolean | null;
          attributes: Json | null;
          backorder_eta_days: number | null;
          combination_key: string;
          content_description: string | null;
          created_at: string | null;
          currency: string | null;
          expiration_date: string | null;
          file_count: number | null;
          id: string;
          is_active: boolean | null;
          is_sample: boolean | null;
          iso_code: string | null;
          lot: string | null;
          metadata: Json | null;
          price: number;
          price_eur: number | null;
          price_try: number | null;
          price_usd: number | null;
          product_id: string | null;
          sku: string;
          stock_quantity: number | null;
        };
        Insert: {
          allow_backorder?: boolean | null;
          attributes?: Json | null;
          backorder_eta_days?: number | null;
          combination_key: string;
          content_description?: string | null;
          created_at?: string | null;
          currency?: string | null;
          expiration_date?: string | null;
          file_count?: number | null;
          id?: string;
          is_active?: boolean | null;
          is_sample?: boolean | null;
          iso_code?: string | null;
          lot?: string | null;
          metadata?: Json | null;
          price: number;
          price_eur?: number | null;
          price_try?: number | null;
          price_usd?: number | null;
          product_id?: string | null;
          sku: string;
          stock_quantity?: number | null;
        };
        Update: {
          allow_backorder?: boolean | null;
          attributes?: Json | null;
          backorder_eta_days?: number | null;
          combination_key?: string;
          content_description?: string | null;
          created_at?: string | null;
          currency?: string | null;
          expiration_date?: string | null;
          file_count?: number | null;
          id?: string;
          is_active?: boolean | null;
          is_sample?: boolean | null;
          iso_code?: string | null;
          lot?: string | null;
          metadata?: Json | null;
          price?: number;
          price_eur?: number | null;
          price_try?: number | null;
          price_usd?: number | null;
          product_id?: string | null;
          sku?: string;
          stock_quantity?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'variant_combinations_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      variant_combinations_backup_fanta_usd_fix_20260520: {
        Row: {
          allow_backorder: boolean | null;
          attributes: Json | null;
          backorder_eta_days: number | null;
          backup_at: string | null;
          combination_key: string | null;
          content_description: string | null;
          created_at: string | null;
          currency: string | null;
          expiration_date: string | null;
          file_count: number | null;
          id: string | null;
          is_active: boolean | null;
          is_sample: boolean | null;
          iso_code: string | null;
          lot: string | null;
          metadata: Json | null;
          price: number | null;
          price_eur: number | null;
          price_try: number | null;
          price_usd: number | null;
          product_id: string | null;
          sku: string | null;
          stock_quantity: number | null;
        };
        Insert: {
          allow_backorder?: boolean | null;
          attributes?: Json | null;
          backorder_eta_days?: number | null;
          backup_at?: string | null;
          combination_key?: string | null;
          content_description?: string | null;
          created_at?: string | null;
          currency?: string | null;
          expiration_date?: string | null;
          file_count?: number | null;
          id?: string | null;
          is_active?: boolean | null;
          is_sample?: boolean | null;
          iso_code?: string | null;
          lot?: string | null;
          metadata?: Json | null;
          price?: number | null;
          price_eur?: number | null;
          price_try?: number | null;
          price_usd?: number | null;
          product_id?: string | null;
          sku?: string | null;
          stock_quantity?: number | null;
        };
        Update: {
          allow_backorder?: boolean | null;
          attributes?: Json | null;
          backorder_eta_days?: number | null;
          backup_at?: string | null;
          combination_key?: string | null;
          content_description?: string | null;
          created_at?: string | null;
          currency?: string | null;
          expiration_date?: string | null;
          file_count?: number | null;
          id?: string | null;
          is_active?: boolean | null;
          is_sample?: boolean | null;
          iso_code?: string | null;
          lot?: string | null;
          metadata?: Json | null;
          price?: number | null;
          price_eur?: number | null;
          price_try?: number | null;
          price_usd?: number | null;
          product_id?: string | null;
          sku?: string | null;
          stock_quantity?: number | null;
        };
        Relationships: [];
      };
      variant_combinations_backup_okodent_eur_fix_20260520: {
        Row: {
          allow_backorder: boolean | null;
          attributes: Json | null;
          backorder_eta_days: number | null;
          backup_at: string | null;
          combination_key: string | null;
          content_description: string | null;
          created_at: string | null;
          currency: string | null;
          expiration_date: string | null;
          file_count: number | null;
          id: string | null;
          is_active: boolean | null;
          is_sample: boolean | null;
          iso_code: string | null;
          lot: string | null;
          metadata: Json | null;
          price: number | null;
          price_try: number | null;
          product_id: string | null;
          sku: string | null;
          stock_quantity: number | null;
        };
        Insert: {
          allow_backorder?: boolean | null;
          attributes?: Json | null;
          backorder_eta_days?: number | null;
          backup_at?: string | null;
          combination_key?: string | null;
          content_description?: string | null;
          created_at?: string | null;
          currency?: string | null;
          expiration_date?: string | null;
          file_count?: number | null;
          id?: string | null;
          is_active?: boolean | null;
          is_sample?: boolean | null;
          iso_code?: string | null;
          lot?: string | null;
          metadata?: Json | null;
          price?: number | null;
          price_try?: number | null;
          product_id?: string | null;
          sku?: string | null;
          stock_quantity?: number | null;
        };
        Update: {
          allow_backorder?: boolean | null;
          attributes?: Json | null;
          backorder_eta_days?: number | null;
          backup_at?: string | null;
          combination_key?: string | null;
          content_description?: string | null;
          created_at?: string | null;
          currency?: string | null;
          expiration_date?: string | null;
          file_count?: number | null;
          id?: string | null;
          is_active?: boolean | null;
          is_sample?: boolean | null;
          iso_code?: string | null;
          lot?: string | null;
          metadata?: Json | null;
          price?: number | null;
          price_try?: number | null;
          product_id?: string | null;
          sku?: string | null;
          stock_quantity?: number | null;
        };
        Relationships: [];
      };
      variant_combinations_backup_olident_eur_fix_20260520: {
        Row: {
          allow_backorder: boolean | null;
          attributes: Json | null;
          backorder_eta_days: number | null;
          backup_at: string | null;
          combination_key: string | null;
          content_description: string | null;
          created_at: string | null;
          currency: string | null;
          expiration_date: string | null;
          file_count: number | null;
          id: string | null;
          is_active: boolean | null;
          is_sample: boolean | null;
          iso_code: string | null;
          lot: string | null;
          metadata: Json | null;
          price: number | null;
          price_eur: number | null;
          price_try: number | null;
          product_id: string | null;
          sku: string | null;
          stock_quantity: number | null;
        };
        Insert: {
          allow_backorder?: boolean | null;
          attributes?: Json | null;
          backorder_eta_days?: number | null;
          backup_at?: string | null;
          combination_key?: string | null;
          content_description?: string | null;
          created_at?: string | null;
          currency?: string | null;
          expiration_date?: string | null;
          file_count?: number | null;
          id?: string | null;
          is_active?: boolean | null;
          is_sample?: boolean | null;
          iso_code?: string | null;
          lot?: string | null;
          metadata?: Json | null;
          price?: number | null;
          price_eur?: number | null;
          price_try?: number | null;
          product_id?: string | null;
          sku?: string | null;
          stock_quantity?: number | null;
        };
        Update: {
          allow_backorder?: boolean | null;
          attributes?: Json | null;
          backorder_eta_days?: number | null;
          backup_at?: string | null;
          combination_key?: string | null;
          content_description?: string | null;
          created_at?: string | null;
          currency?: string | null;
          expiration_date?: string | null;
          file_count?: number | null;
          id?: string | null;
          is_active?: boolean | null;
          is_sample?: boolean | null;
          iso_code?: string | null;
          lot?: string | null;
          metadata?: Json | null;
          price?: number | null;
          price_eur?: number | null;
          price_try?: number | null;
          product_id?: string | null;
          sku?: string | null;
          stock_quantity?: number | null;
        };
        Relationships: [];
      };
      variant_groups: {
        Row: {
          condition: string | null;
          created_at: string | null;
          display_order: number | null;
          group_name: string;
          group_type: string;
          id: string;
          mutually_exclusive: boolean | null;
          product_id: string | null;
        };
        Insert: {
          condition?: string | null;
          created_at?: string | null;
          display_order?: number | null;
          group_name: string;
          group_type: string;
          id?: string;
          mutually_exclusive?: boolean | null;
          product_id?: string | null;
        };
        Update: {
          condition?: string | null;
          created_at?: string | null;
          display_order?: number | null;
          group_name?: string;
          group_type?: string;
          id?: string;
          mutually_exclusive?: boolean | null;
          product_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'variant_groups_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
        ];
      };
      variant_options: {
        Row: {
          created_at: string | null;
          display_order: number | null;
          id: string;
          is_default: boolean | null;
          metadata: Json | null;
          option_name: string;
          option_value: string;
          price_adjustment: number | null;
          sku_suffix: string | null;
          stock_quantity: number | null;
          variant_group_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          display_order?: number | null;
          id?: string;
          is_default?: boolean | null;
          metadata?: Json | null;
          option_name: string;
          option_value: string;
          price_adjustment?: number | null;
          sku_suffix?: string | null;
          stock_quantity?: number | null;
          variant_group_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          display_order?: number | null;
          id?: string;
          is_default?: boolean | null;
          metadata?: Json | null;
          option_name?: string;
          option_value?: string;
          price_adjustment?: number | null;
          sku_suffix?: string | null;
          stock_quantity?: number | null;
          variant_group_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'variant_options_variant_group_id_fkey';
            columns: ['variant_group_id'];
            isOneToOne: false;
            referencedRelation: 'variant_groups';
            referencedColumns: ['id'];
          },
        ];
      };
      wallet_transactions: {
        Row: {
          amount: number;
          created_at: string;
          created_by: string | null;
          description: string;
          id: string;
          profile_id: string;
          reference_id: string | null;
          type: string;
          updated_at: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          created_by?: string | null;
          description: string;
          id?: string;
          profile_id: string;
          reference_id?: string | null;
          type: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          id?: string;
          profile_id?: string;
          reference_id?: string | null;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'wallet_transactions_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'wallet_transactions_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      wallet_transactions_backup_20260518: {
        Row: {
          amount: number | null;
          created_at: string | null;
          created_by: string | null;
          description: string | null;
          id: string | null;
          profile_id: string | null;
          reference_id: string | null;
          type: string | null;
          updated_at: string | null;
        };
        Insert: {
          amount?: number | null;
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          id?: string | null;
          profile_id?: string | null;
          reference_id?: string | null;
          type?: string | null;
          updated_at?: string | null;
        };
        Update: {
          amount?: number | null;
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          id?: string | null;
          profile_id?: string | null;
          reference_id?: string | null;
          type?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      wishlist: {
        Row: {
          created_at: string;
          id: string;
          notes: string | null;
          product_id: string;
          user_id: string;
          variant_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          notes?: string | null;
          product_id: string;
          user_id: string;
          variant_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          notes?: string | null;
          product_id?: string;
          user_id?: string;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'wishlist_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'wishlist_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      aging_report: {
        Row: {
          account_id: string | null;
          ad_soyad: string | null;
          bucket_0_30: number | null;
          bucket_31_60: number | null;
          bucket_61_90: number | null;
          bucket_90_plus: number | null;
          company_name: string | null;
          credit_limit: number | null;
          current_balance: number | null;
          email: string | null;
          risk_level: string | null;
          total_overdue: number | null;
          user_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_accounts_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      geography_columns: {
        Row: {
          coord_dimension: number | null;
          f_geography_column: unknown;
          f_table_catalog: unknown;
          f_table_name: unknown;
          f_table_schema: unknown;
          srid: number | null;
          type: string | null;
        };
        Relationships: [];
      };
      geometry_columns: {
        Row: {
          coord_dimension: number | null;
          f_geometry_column: unknown;
          f_table_catalog: string | null;
          f_table_name: unknown;
          f_table_schema: unknown;
          srid: number | null;
          type: string | null;
        };
        Insert: {
          coord_dimension?: number | null;
          f_geometry_column?: unknown;
          f_table_catalog?: string | null;
          f_table_name?: unknown;
          f_table_schema?: unknown;
          srid?: number | null;
          type?: string | null;
        };
        Update: {
          coord_dimension?: number | null;
          f_geometry_column?: unknown;
          f_table_catalog?: string | null;
          f_table_name?: unknown;
          f_table_schema?: unknown;
          srid?: number | null;
          type?: string | null;
        };
        Relationships: [];
      };
      overdue_transactions: {
        Row: {
          account_id: string | null;
          amount: number | null;
          created_at: string | null;
          created_by: string | null;
          days_overdue: number | null;
          description: string | null;
          due_date: string | null;
          id: string | null;
          is_paid: boolean | null;
          order_id: string | null;
          paid_at: string | null;
          payment_id: string | null;
          reference_number: string | null;
          transaction_type: string | null;
        };
        Insert: {
          account_id?: string | null;
          amount?: number | null;
          created_at?: string | null;
          created_by?: string | null;
          days_overdue?: never;
          description?: string | null;
          due_date?: string | null;
          id?: string | null;
          is_paid?: boolean | null;
          order_id?: string | null;
          paid_at?: string | null;
          payment_id?: string | null;
          reference_number?: string | null;
          transaction_type?: string | null;
        };
        Update: {
          account_id?: string | null;
          amount?: number | null;
          created_at?: string | null;
          created_by?: string | null;
          days_overdue?: never;
          description?: string | null;
          due_date?: string | null;
          id?: string | null;
          is_paid?: boolean | null;
          order_id?: string | null;
          paid_at?: string | null;
          payment_id?: string | null;
          reference_number?: string | null;
          transaction_type?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'account_transactions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'aging_report';
            referencedColumns: ['account_id'];
          },
          {
            foreignKeyName: 'account_transactions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'customer_accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'account_transactions_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      product_review_aggregates: {
        Row: {
          avg_rating: number | null;
          product_id: string | null;
          review_count: number | null;
        };
        Relationships: [];
      };
      unread_notification_counts: {
        Row: {
          low_stock_alerts: number | null;
          new_orders: number | null;
          status_changes: number | null;
          total_unread: number | null;
          user_id: string | null;
        };
        Relationships: [];
      };
      v_fanta_products: {
        Row: {
          accessories_compat: Json | null;
          application_protocol: Json | null;
          base_code: string | null;
          brand: string | null;
          category_id: string | null;
          clinical_indications: Json | null;
          confidence: string | null;
          contraindications: Json | null;
          description: string | null;
          gallery_images: Json | null;
          id: string | null;
          is_active: boolean | null;
          is_featured: boolean | null;
          main_image: string | null;
          maintenance: Json | null;
          meta_description: string | null;
          meta_title: string | null;
          motion_type: string | null;
          name: string | null;
          price_try: number | null;
          price_usd: number | null;
          product_variants: Json | null;
          regulatory: Json | null;
          sales_pitch: string | null;
          short_description: string | null;
          slug: string | null;
          sort_order: number | null;
          sources: Json | null;
          stock_quantity: number | null;
          stock_status: string | null;
          technical_specs: Json | null;
          wire_tech: string | null;
        };
        Insert: {
          accessories_compat?: Json | null;
          application_protocol?: Json | null;
          base_code?: string | null;
          brand?: never;
          category_id?: string | null;
          clinical_indications?: Json | null;
          confidence?: string | null;
          contraindications?: Json | null;
          description?: string | null;
          gallery_images?: Json | null;
          id?: never;
          is_active?: never;
          is_featured?: never;
          main_image?: string | null;
          maintenance?: Json | null;
          meta_description?: string | null;
          meta_title?: string | null;
          motion_type?: string | null;
          name?: string | null;
          price_try?: number | null;
          price_usd?: number | null;
          product_variants?: never;
          regulatory?: Json | null;
          sales_pitch?: string | null;
          short_description?: never;
          slug?: string | null;
          sort_order?: number | null;
          sources?: Json | null;
          stock_quantity?: never;
          stock_status?: never;
          technical_specs?: Json | null;
          wire_tech?: string | null;
        };
        Update: {
          accessories_compat?: Json | null;
          application_protocol?: Json | null;
          base_code?: string | null;
          brand?: never;
          category_id?: string | null;
          clinical_indications?: Json | null;
          confidence?: string | null;
          contraindications?: Json | null;
          description?: string | null;
          gallery_images?: Json | null;
          id?: never;
          is_active?: never;
          is_featured?: never;
          main_image?: string | null;
          maintenance?: Json | null;
          meta_description?: string | null;
          meta_title?: string | null;
          motion_type?: string | null;
          name?: string | null;
          price_try?: number | null;
          price_usd?: number | null;
          product_variants?: never;
          regulatory?: Json | null;
          sales_pitch?: string | null;
          short_description?: never;
          slug?: string | null;
          sort_order?: number | null;
          sources?: Json | null;
          stock_quantity?: never;
          stock_status?: never;
          technical_specs?: Json | null;
          wire_tech?: string | null;
        };
        Relationships: [];
      };
      v_olident_products: {
        Row: {
          application_protocol: Json | null;
          base_code: string | null;
          brand: string | null;
          category_id: string | null;
          clinical_evidence: Json | null;
          composite_type: string | null;
          consistency: string | null;
          contraindications: Json | null;
          curing: string | null;
          description: string | null;
          expert_opinion: string | null;
          expert_protips: Json | null;
          gallery_images: Json | null;
          id: string | null;
          indications: Json | null;
          is_active: boolean | null;
          is_featured: boolean | null;
          key_features: Json | null;
          main_image: string | null;
          meta_description: string | null;
          meta_title: string | null;
          name: string | null;
          price_usd: number | null;
          product_variants: Json | null;
          recommended_combinations: Json | null;
          regulatory: Json | null;
          shade_count_summary: Json | null;
          shades: Json | null;
          short_description: string | null;
          slug: string | null;
          sort_order: number | null;
          stock_quantity: number | null;
          stock_status: string | null;
          technical_properties: Json | null;
        };
        Insert: {
          application_protocol?: Json | null;
          base_code?: string | null;
          brand?: never;
          category_id?: string | null;
          clinical_evidence?: Json | null;
          composite_type?: string | null;
          consistency?: string | null;
          contraindications?: Json | null;
          curing?: string | null;
          description?: string | null;
          expert_opinion?: string | null;
          expert_protips?: Json | null;
          gallery_images?: Json | null;
          id?: never;
          indications?: Json | null;
          is_active?: boolean | null;
          is_featured?: never;
          key_features?: Json | null;
          main_image?: string | null;
          meta_description?: string | null;
          meta_title?: string | null;
          name?: string | null;
          price_usd?: number | null;
          product_variants?: never;
          recommended_combinations?: Json | null;
          regulatory?: Json | null;
          shade_count_summary?: Json | null;
          shades?: never;
          short_description?: string | null;
          slug?: string | null;
          sort_order?: number | null;
          stock_quantity?: never;
          stock_status?: never;
          technical_properties?: Json | null;
        };
        Update: {
          application_protocol?: Json | null;
          base_code?: string | null;
          brand?: never;
          category_id?: string | null;
          clinical_evidence?: Json | null;
          composite_type?: string | null;
          consistency?: string | null;
          contraindications?: Json | null;
          curing?: string | null;
          description?: string | null;
          expert_opinion?: string | null;
          expert_protips?: Json | null;
          gallery_images?: Json | null;
          id?: never;
          indications?: Json | null;
          is_active?: boolean | null;
          is_featured?: never;
          key_features?: Json | null;
          main_image?: string | null;
          meta_description?: string | null;
          meta_title?: string | null;
          name?: string | null;
          price_usd?: number | null;
          product_variants?: never;
          recommended_combinations?: Json | null;
          regulatory?: Json | null;
          shade_count_summary?: Json | null;
          shades?: never;
          short_description?: string | null;
          slug?: string | null;
          sort_order?: number | null;
          stock_quantity?: never;
          stock_status?: never;
          technical_properties?: Json | null;
        };
        Relationships: [];
      };
      v_popular_searches: {
        Row: {
          hit_count: number | null;
          last_searched_at: string | null;
          query: string | null;
        };
        Relationships: [];
      };
      v_saha_products: {
        Row: {
          base_price: number | null;
          brand: string | null;
          category_id: string | null;
          currency: string | null;
          description: string | null;
          id: string | null;
          is_active: boolean | null;
          main_image: string | null;
          name: string | null;
          product_variants: Json | null;
          sale_price: number | null;
          sku: string | null;
          source: string | null;
          stock_quantity: number | null;
          stock_status: string | null;
          tax_rate: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      _cron_fanout_scheduled_notifications: { Args: never; Returns: Json };
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string };
        Returns: undefined;
      };
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown };
        Returns: unknown;
      };
      _postgis_pgsql_version: { Args: never; Returns: string };
      _postgis_scripts_pgsql_version: { Args: never; Returns: string };
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown };
        Returns: number;
      };
      _postgis_stats: {
        Args: { ''?: string; att_name: string; tbl: unknown };
        Returns: string;
      };
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      _st_dwithin: {
        Args: {
          geog1: unknown;
          geog2: unknown;
          tolerance: number;
          use_spheroid?: boolean;
        };
        Returns: boolean;
      };
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown };
        Returns: number;
      };
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      _st_sortablehash: { Args: { geom: unknown }; Returns: number };
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      _st_voronoi: {
        Args: {
          clip?: unknown;
          g1: unknown;
          return_polygons?: boolean;
          tolerance?: number;
        };
        Returns: unknown;
      };
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      addauth: { Args: { '': string }; Returns: boolean };
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string;
              column_name: string;
              new_dim: number;
              new_srid_in: number;
              new_type: string;
              schema_name: string;
              table_name: string;
              use_typmod?: boolean;
            };
            Returns: string;
          }
        | {
            Args: {
              column_name: string;
              new_dim: number;
              new_srid: number;
              new_type: string;
              schema_name: string;
              table_name: string;
              use_typmod?: boolean;
            };
            Returns: string;
          }
        | {
            Args: {
              column_name: string;
              new_dim: number;
              new_srid: number;
              new_type: string;
              table_name: string;
              use_typmod?: boolean;
            };
            Returns: string;
          };
      adjust_cari: {
        Args: { p_account_id: string; p_delta: number; p_reason?: string };
        Returns: Json;
      };
      adjust_stock: {
        Args: { p_delta: number; p_reason?: string; p_variant_id: string };
        Returns: Json;
      };
      adjust_wallet: {
        Args: {
          p_amount: number;
          p_description?: string;
          p_reference_id?: string;
          p_type: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      approve_order_if_authorized: {
        Args: { p_order_id: string };
        Returns: undefined;
      };
      approve_rma: {
        Args: { p_admin_note?: string; p_id: string; p_refund_amount?: number };
        Returns: Json;
      };
      atomic_reserve_stock: {
        Args: {
          p_expires_at: string;
          p_items: Json;
          p_session_id: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      broadcast_notification: {
        Args: {
          p_data?: Json;
          p_message: string;
          p_target?: string;
          p_title: string;
          p_type?: string;
          p_user_ids?: string[];
        };
        Returns: Json;
      };
      check_and_reserve_stock_with_backorder: {
        Args: { p_items: Json; p_session_id: string; p_user_id?: string };
        Returns: Json;
      };
      check_credit_limit: {
        Args: { requested_amount: number; user_uuid: string };
        Returns: Json;
      };
      check_is_admin: { Args: { uid: string }; Returns: boolean };
      check_sample_eligibility: {
        Args: { p_clinic_id?: string; p_product_id: string; p_user_id: string };
        Returns: Json;
      };
      check_scan_budget: {
        Args: { p_estimated_queries: number };
        Returns: boolean;
      };
      cleanup_expired_reservations: { Args: never; Returns: undefined };
      create_partial_shipments: {
        Args: { p_delivery_type?: string; p_order_id: string };
        Returns: Json;
      };
      create_sample_request: {
        Args: {
          p_clinic_id?: string;
          p_doctor_notes?: string;
          p_product_id: string;
          p_quantity?: number;
          p_user_id: string;
          p_variant_id?: string;
        };
        Returns: Json;
      };
      create_task_from_notification: {
        Args: { p_notification_id: string };
        Returns: {
          client_id: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          notes: string | null;
          rep_id: string;
          scheduled_date: string;
          scheduled_time: string | null;
          source_notification_id: string | null;
          status: Database['public']['Enums']['rep_task_status'];
          task_type: Database['public']['Enums']['rep_task_type'];
          title: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'rep_tasks';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      decrease_stock: {
        Args: { p_quantity: number; p_variant_id: string };
        Returns: Json;
      };
      decrement_coupon_used_count: {
        Args: { p_coupon_id: string };
        Returns: undefined;
      };
      disablelongtransactions: { Args: never; Returns: string };
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string;
              column_name: string;
              schema_name: string;
              table_name: string;
            };
            Returns: string;
          }
        | {
            Args: {
              column_name: string;
              schema_name: string;
              table_name: string;
            };
            Returns: string;
          }
        | { Args: { column_name: string; table_name: string }; Returns: string };
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string;
              schema_name: string;
              table_name: string;
            };
            Returns: string;
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string };
      enablelongtransactions: { Args: never; Returns: string };
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      fanta_set_family_content: {
        Args: {
          p_accessories_compat?: Json;
          p_application_protocol?: Json;
          p_clinical_indications?: Json;
          p_confidence?: string;
          p_contraindications?: Json;
          p_maintenance?: Json;
          p_regulatory?: Json;
          p_sales_pitch?: string;
          p_slug: string;
          p_sources?: Json;
          p_technical_specs?: Json;
        };
        Returns: {
          confidence: string;
          rows_updated: number;
          slug: string;
          updated_at: string;
        }[];
      };
      fanta_set_family_gallery: {
        Args: { p_slug: string; p_urls: Json };
        Returns: {
          gallery_images: Json;
          slug: string;
          updated_at: string;
        }[];
      };
      fanta_set_family_image: {
        Args: { p_slug: string; p_url: string };
        Returns: {
          image_url: string;
          slug: string;
          updated_at: string;
        }[];
      };
      fanta_set_family_price: {
        Args: { p_price_usd: number; p_slug: string };
        Returns: {
          price_usd: number;
          slug: string;
          updated_at: string;
        }[];
      };
      fanta_set_family_price_usd: {
        Args: { p_price_usd: number; p_slug: string };
        Returns: Json;
      };
      fanta_set_family_stock: {
        Args: { p_slug: string; p_stock: number };
        Returns: Json;
      };
      fulfill_backorder: {
        Args: { p_note?: string; p_order_item_id: string };
        Returns: Json;
      };
      generate_cari_kodu: { Args: never; Returns: string };
      generate_fatura_no: { Args: never; Returns: string };
      geometry: { Args: { '': string }; Returns: unknown };
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      geomfromewkt: { Args: { '': string }; Returns: unknown };
      get_effective_stock: { Args: { p_variant_id: string }; Returns: number };
      get_effective_stock_bulk: {
        Args: { p_variant_ids: string[] };
        Returns: {
          effective_stock: number;
          variant_id: string;
        }[];
      };
      get_near_expiration_variants: {
        Args: never;
        Returns: {
          allow_backorder: boolean | null;
          attributes: Json | null;
          backorder_eta_days: number | null;
          combination_key: string;
          content_description: string | null;
          created_at: string | null;
          currency: string | null;
          expiration_date: string | null;
          file_count: number | null;
          id: string;
          is_active: boolean | null;
          is_sample: boolean | null;
          iso_code: string | null;
          lot: string | null;
          metadata: Json | null;
          price: number;
          price_eur: number | null;
          price_try: number | null;
          price_usd: number | null;
          product_id: string | null;
          sku: string;
          stock_quantity: number | null;
        }[];
        SetofOptions: {
          from: '*';
          to: 'variant_combinations';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      get_public_setting: { Args: { p_key: string }; Returns: Json };
      get_user_permissions: {
        Args: { p_uid: string };
        Returns: {
          permission_code: string;
        }[];
      };
      gettransactionid: { Args: never; Returns: unknown };
      has_permission: {
        Args: { p_code: string; p_user_id: string };
        Returns: boolean;
      };
      increment_scan_job_progress: {
        Args: { p_job_id: string; p_new_clinics: number; p_total_found: number };
        Returns: undefined;
      };
      is_admin: { Args: never; Returns: boolean };
      is_admin_panel_user: { Args: never; Returns: boolean };
      log_admin_action: {
        Args: {
          p_action: string;
          p_diff?: Json;
          p_metadata?: Json;
          p_target_id?: string;
          p_target_table?: string;
        };
        Returns: string;
      };
      longtransactionsenabled: { Args: never; Returns: boolean };
      mark_notifications_read: {
        Args: { p_notification_ids: string[] };
        Returns: number;
      };
      my_permissions: {
        Args: never;
        Returns: {
          permission_code: string;
          source: string;
        }[];
      };
      next_order_number: { Args: never; Returns: string };
      olident_set_family_content: {
        Args: {
          p_application_protocol?: Json;
          p_clinical_evidence?: Json;
          p_contraindications?: Json;
          p_regulatory?: Json;
          p_slug: string;
        };
        Returns: number;
      };
      olident_set_family_gallery: {
        Args: { p_slug: string; p_urls: Json };
        Returns: {
          gallery_images: Json;
          slug: string;
          updated_at: string;
        }[];
      };
      olident_set_family_image: {
        Args: { p_slug: string; p_url: string };
        Returns: {
          image_url: string;
          slug: string;
          updated_at: string;
        }[];
      };
      olident_set_family_price: {
        Args: { p_price_usd: number; p_slug: string };
        Returns: {
          price_usd: number;
          slug: string;
          updated_at: string;
        }[];
      };
      olident_set_family_stock: {
        Args: { p_slug: string; p_stock: number };
        Returns: Json;
      };
      olident_set_shade_attrs: {
        Args: { p_attrs: Json; p_family_slug: string; p_shade_code: string };
        Returns: number;
      };
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string };
      post_order_to_cash: { Args: { p_order_id: string }; Returns: string };
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string };
        Returns: number;
      };
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string };
        Returns: number;
      };
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string };
        Returns: string;
      };
      postgis_extensions_upgrade: { Args: never; Returns: string };
      postgis_full_version: { Args: never; Returns: string };
      postgis_geos_version: { Args: never; Returns: string };
      postgis_lib_build_date: { Args: never; Returns: string };
      postgis_lib_revision: { Args: never; Returns: string };
      postgis_lib_version: { Args: never; Returns: string };
      postgis_libjson_version: { Args: never; Returns: string };
      postgis_liblwgeom_version: { Args: never; Returns: string };
      postgis_libprotobuf_version: { Args: never; Returns: string };
      postgis_libxml_version: { Args: never; Returns: string };
      postgis_proj_version: { Args: never; Returns: string };
      postgis_scripts_build_date: { Args: never; Returns: string };
      postgis_scripts_installed: { Args: never; Returns: string };
      postgis_scripts_released: { Args: never; Returns: string };
      postgis_svn_version: { Args: never; Returns: string };
      postgis_type_name: {
        Args: {
          coord_dimension: number;
          geomname: string;
          use_new_name?: boolean;
        };
        Returns: string;
      };
      postgis_version: { Args: never; Returns: string };
      postgis_wagyu_version: { Args: never; Returns: string };
      purge_old_checkin_coords: { Args: never; Returns: Json };
      record_scan_queries: {
        Args: { p_meta?: Json; p_queries: number; p_user_id: string };
        Returns: undefined;
      };
      referral_apply: {
        Args: {
          p_cart_subtotal?: number;
          p_code: string;
          p_order_id: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      referral_validate: {
        Args: { p_code: string };
        Returns: {
          discount_type: string;
          discount_value: number;
          message: string;
          valid: boolean;
        }[];
      };
      refresh_eur_prices: { Args: { p_eur_rate: number }; Returns: number };
      refresh_fx_prices: {
        Args: { p_eur_rate: number; p_usd_rate: number };
        Returns: Json;
      };
      refund_rma: { Args: { p_id: string }; Returns: Json };
      reject_rma: {
        Args: { p_admin_note?: string; p_id: string };
        Returns: Json;
      };
      request_order_invoice: {
        Args: { p_order_id: string };
        Returns: {
          created_at: string;
          id: string;
          note: string | null;
          order_id: string;
          requested_by: string | null;
          status: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'saha_invoice_requests';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      reserve_and_confirm_stock: {
        Args: { items: Json; order_id?: string; user_id?: string };
        Returns: Json;
      };
      restore_stock_on_refund: { Args: { p_order_id: string }; Returns: Json };
      saha_clinics_by_district: {
        Args: {
          _district_slug: string;
          _limit?: number;
          _province_slug: string;
          _vertical_key?: string;
        };
        Returns: {
          address: string;
          clinic_segment: string;
          google_place_id: string;
          id: string;
          lat: number;
          lng: number;
          name: string;
          phone: string;
          rating: number;
          types: string[];
          user_ratings_total: number;
        }[];
      };
      saha_clinics_count_by_province: {
        Args: { _slugs: string[]; _vertical_key?: string };
        Returns: {
          count: number;
          province_slug: string;
        }[];
      };
      saha_clinics_near_polyline: {
        Args: {
          _buffer_m?: number;
          _limit?: number;
          _line_geojson: string;
          _vertical_key?: string;
        };
        Returns: {
          address: string;
          clinic_segment: string;
          district_slug: string;
          google_place_id: string;
          id: string;
          lat: number;
          lng: number;
          name: string;
          phone: string;
          province_slug: string;
          rating: number;
          types: string[];
          user_ratings_total: number;
        }[];
      };
      saha_get_or_create_cari_for_clinic: {
        Args: { p_clinic_id: string };
        Returns: string;
      };
      saha_is_admin: { Args: never; Returns: boolean };
      saha_is_manager_or_admin: { Args: never; Returns: boolean };
      saha_is_rep_or_admin: { Args: never; Returns: boolean };
      saha_search_nearby_accounts: {
        Args: {
          _customer_type?: string;
          _lat: number;
          _limit?: number;
          _lng: number;
          _radius_m: number;
        };
        Returns: {
          addresses: Json;
          contacts: Json;
          created_at: string;
          custom_fields: Json;
          distance_m: number;
          email: string;
          id: string;
          name: string;
          phone: string;
          region: string;
          status: string;
          type: string;
          updated_at: string;
          whatsapp: string;
        }[];
      };
      saha_search_clinics: {
        Args: {
          _q: string;
          _vertical_key?: string;
          _statuses?: string[];
          _limit?: number;
        };
        Returns: {
          id: string;
          name: string;
          address: string;
          phone: string;
          lat: number;
          lng: number;
          province_slug: string;
          district_slug: string;
          status: string;
          rating: number;
          user_ratings_total: number;
          potential: number;
        }[];
      };
      saha_search_nearby_clinics: {
        Args: {
          _lat: number;
          _limit?: number;
          _lng: number;
          _radius_m: number;
          _vertical_key?: string;
        };
        Returns: {
          address: string;
          clinic_segment: string;
          distance_m: number;
          district_slug: string;
          google_place_id: string;
          id: string;
          last_verified_at: string;
          lat: number;
          lng: number;
          name: string;
          phone: string;
          province_slug: string;
          rating: number;
          types: string[];
          user_ratings_total: number;
        }[];
      };
      set_backorder_eta: {
        Args: { p_eta_days: number; p_note?: string; p_order_item_id: string };
        Returns: Json;
      };
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown };
            Returns: number;
          };
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { '': string }; Returns: number };
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number };
        Returns: string;
      };
      st_asewkt: { Args: { '': string }; Returns: string };
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number };
            Returns: string;
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number };
            Returns: string;
          }
        | {
            Args: {
              geom_column?: string;
              maxdecimaldigits?: number;
              pretty_bool?: boolean;
              r: Record<string, unknown>;
            };
            Returns: string;
          }
        | { Args: { '': string }; Returns: string };
      st_asgml:
        | {
            Args: {
              geog: unknown;
              id?: string;
              maxdecimaldigits?: number;
              nprefix?: string;
              options?: number;
            };
            Returns: string;
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number };
            Returns: string;
          }
        | { Args: { '': string }; Returns: string }
        | {
            Args: {
              geog: unknown;
              id?: string;
              maxdecimaldigits?: number;
              nprefix?: string;
              options?: number;
              version: number;
            };
            Returns: string;
          }
        | {
            Args: {
              geom: unknown;
              id?: string;
              maxdecimaldigits?: number;
              nprefix?: string;
              options?: number;
              version: number;
            };
            Returns: string;
          };
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string };
            Returns: string;
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string };
            Returns: string;
          }
        | { Args: { '': string }; Returns: string };
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string };
        Returns: string;
      };
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string };
      st_asmvtgeom: {
        Args: {
          bounds: unknown;
          buffer?: number;
          clip_geom?: boolean;
          extent?: number;
          geom: unknown;
        };
        Returns: unknown;
      };
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number };
            Returns: string;
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number };
            Returns: string;
          }
        | { Args: { '': string }; Returns: string };
      st_astext: { Args: { '': string }; Returns: string };
      st_astwkb:
        | {
            Args: {
              geom: unknown;
              prec?: number;
              prec_m?: number;
              prec_z?: number;
              with_boxes?: boolean;
              with_sizes?: boolean;
            };
            Returns: string;
          }
        | {
            Args: {
              geom: unknown[];
              ids: number[];
              prec?: number;
              prec_m?: number;
              prec_z?: number;
              with_boxes?: boolean;
              with_sizes?: boolean;
            };
            Returns: string;
          };
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number };
        Returns: string;
      };
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number };
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown };
        Returns: unknown;
      };
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number };
            Returns: unknown;
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number };
            Returns: unknown;
          };
      st_centroid: { Args: { '': string }; Returns: unknown };
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown };
        Returns: unknown;
      };
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown };
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean;
          param_geom: unknown;
          param_pctconvex: number;
        };
        Returns: unknown;
      };
      st_contains: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      st_coorddim: { Args: { geometry: unknown }; Returns: number };
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number };
        Returns: unknown;
      };
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number };
        Returns: unknown;
      };
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number };
        Returns: unknown;
      };
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean };
            Returns: number;
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number };
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number };
            Returns: number;
          };
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      st_dwithin: {
        Args: {
          geog1: unknown;
          geog2: unknown;
          tolerance: number;
          use_spheroid?: boolean;
        };
        Returns: boolean;
      };
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number };
            Returns: unknown;
          }
        | {
            Args: {
              dm?: number;
              dx: number;
              dy: number;
              dz?: number;
              geom: unknown;
            };
            Returns: unknown;
          };
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown };
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number };
        Returns: unknown;
      };
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number };
        Returns: unknown;
      };
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number };
        Returns: unknown;
      };
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number };
            Returns: unknown;
          };
      st_geogfromtext: { Args: { '': string }; Returns: unknown };
      st_geographyfromtext: { Args: { '': string }; Returns: unknown };
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string };
      st_geomcollfromtext: { Args: { '': string }; Returns: unknown };
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean;
          g: unknown;
          max_iter?: number;
          tolerance?: number;
        };
        Returns: unknown;
      };
      st_geometryfromtext: { Args: { '': string }; Returns: unknown };
      st_geomfromewkt: { Args: { '': string }; Returns: unknown };
      st_geomfromgeojson:
        | { Args: { '': Json }; Returns: unknown }
        | { Args: { '': Json }; Returns: unknown }
        | { Args: { '': string }; Returns: unknown };
      st_geomfromgml: { Args: { '': string }; Returns: unknown };
      st_geomfromkml: { Args: { '': string }; Returns: unknown };
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown };
      st_geomfromtext: { Args: { '': string }; Returns: unknown };
      st_gmltosql: { Args: { '': string }; Returns: unknown };
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean };
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number };
        Returns: unknown;
      };
      st_hexagongrid: {
        Args: { bounds: unknown; size: number };
        Returns: Record<string, unknown>[];
      };
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown };
        Returns: number;
      };
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number };
        Returns: unknown;
      };
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown };
        Returns: Database['public']['CompositeTypes']['valid_detail'];
        SetofOptions: {
          from: '*';
          to: 'valid_detail';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { '': string }; Returns: number };
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown };
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown };
        Returns: number;
      };
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string };
        Returns: unknown;
      };
      st_linefromtext: { Args: { '': string }; Returns: unknown };
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown };
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number };
        Returns: unknown;
      };
      st_locatebetween: {
        Args: {
          frommeasure: number;
          geometry: unknown;
          leftrightoffset?: number;
          tomeasure: number;
        };
        Returns: unknown;
      };
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number };
        Returns: unknown;
      };
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_makevalid: {
        Args: { geom: unknown; params: string };
        Returns: unknown;
      };
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: number;
      };
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number };
        Returns: unknown;
      };
      st_mlinefromtext: { Args: { '': string }; Returns: unknown };
      st_mpointfromtext: { Args: { '': string }; Returns: unknown };
      st_mpolyfromtext: { Args: { '': string }; Returns: unknown };
      st_multilinestringfromtext: { Args: { '': string }; Returns: unknown };
      st_multipointfromtext: { Args: { '': string }; Returns: unknown };
      st_multipolygonfromtext: { Args: { '': string }; Returns: unknown };
      st_node: { Args: { g: unknown }; Returns: unknown };
      st_normalize: { Args: { geom: unknown }; Returns: unknown };
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string };
        Returns: unknown;
      };
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: boolean;
      };
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean };
        Returns: number;
      };
      st_pointfromtext: { Args: { '': string }; Returns: unknown };
      st_pointm: {
        Args: {
          mcoordinate: number;
          srid?: number;
          xcoordinate: number;
          ycoordinate: number;
        };
        Returns: unknown;
      };
      st_pointz: {
        Args: {
          srid?: number;
          xcoordinate: number;
          ycoordinate: number;
          zcoordinate: number;
        };
        Returns: unknown;
      };
      st_pointzm: {
        Args: {
          mcoordinate: number;
          srid?: number;
          xcoordinate: number;
          ycoordinate: number;
          zcoordinate: number;
        };
        Returns: unknown;
      };
      st_polyfromtext: { Args: { '': string }; Returns: unknown };
      st_polygonfromtext: { Args: { '': string }; Returns: unknown };
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown };
        Returns: unknown;
      };
      st_quantizecoordinates: {
        Args: {
          g: unknown;
          prec_m?: number;
          prec_x: number;
          prec_y?: number;
          prec_z?: number;
        };
        Returns: unknown;
      };
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number };
        Returns: unknown;
      };
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string };
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number };
        Returns: unknown;
      };
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number };
        Returns: unknown;
      };
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown };
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number };
        Returns: unknown;
      };
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown };
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number };
        Returns: unknown;
      };
      st_squaregrid: {
        Args: { bounds: unknown; size: number };
        Returns: Record<string, unknown>[];
      };
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number };
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number };
        Returns: unknown[];
      };
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown };
        Returns: unknown;
      };
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number };
        Returns: unknown;
      };
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown };
        Returns: unknown;
      };
      st_tileenvelope: {
        Args: {
          bounds?: unknown;
          margin?: number;
          x: number;
          y: number;
          zoom: number;
        };
        Returns: unknown;
      };
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string };
            Returns: unknown;
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number };
            Returns: unknown;
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown };
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown };
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number };
            Returns: unknown;
          };
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number };
        Returns: unknown;
      };
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number };
        Returns: unknown;
      };
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean };
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown };
      st_wkttosql: { Args: { '': string }; Returns: unknown };
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number };
        Returns: unknown;
      };
      unlockrows: { Args: { '': string }; Returns: number };
      update_backorder_status: {
        Args: {
          p_new_status: string;
          p_note?: string;
          p_order_id: string;
          p_updated_by?: string;
        };
        Returns: Json;
      };
      update_sample_request_status: {
        Args: {
          p_changed_by: string;
          p_new_status: string;
          p_notes?: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      updategeometrysrid: {
        Args: {
          catalogn_name: string;
          column_name: string;
          new_srid_in: number;
          schema_name: string;
          table_name: string;
        };
        Returns: string;
      };
      upsert_daily_note: {
        Args: { p_content: string; p_date: string };
        Returns: {
          content: string;
          created_at: string;
          id: string;
          note_date: string;
          rep_id: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'rep_daily_notes';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      assistant_approval_status: 'pending' | 'approved' | 'rejected';
      notification_channel: 'in_app' | 'email' | 'push';
      notification_status: 'pending' | 'sent' | 'failed' | 'delivered';
      notification_type:
        | 'new_order'
        | 'order_status_change'
        | 'low_stock'
        | 'new_user'
        | 'payment_received'
        | 'payment_failed'
        | 'system_alert';
      rep_task_status: 'pending' | 'done' | 'skipped';
      rep_task_type: 'visit' | 'call' | 'paperwork' | 'other';
      user_role:
        | 'GUEST'
        | 'DOCTOR'
        | 'ASSISTANT'
        | 'REP'
        | 'ADMIN'
        | 'PENDING'
        | 'content_editor'
        | 'accountant'
        | 'DEALER'
        | 'CLINIC'
        | 'warehouse';
    };
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null;
        geom: unknown;
      };
      valid_detail: {
        valid: boolean | null;
        reason: string | null;
        location: unknown;
      };
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      assistant_approval_status: ['pending', 'approved', 'rejected'],
      notification_channel: ['in_app', 'email', 'push'],
      notification_status: ['pending', 'sent', 'failed', 'delivered'],
      notification_type: [
        'new_order',
        'order_status_change',
        'low_stock',
        'new_user',
        'payment_received',
        'payment_failed',
        'system_alert',
      ],
      rep_task_status: ['pending', 'done', 'skipped'],
      rep_task_type: ['visit', 'call', 'paperwork', 'other'],
      user_role: [
        'GUEST',
        'DOCTOR',
        'ASSISTANT',
        'REP',
        'ADMIN',
        'PENDING',
        'content_editor',
        'accountant',
        'DEALER',
        'CLINIC',
        'warehouse',
      ],
    },
  },
} as const;
