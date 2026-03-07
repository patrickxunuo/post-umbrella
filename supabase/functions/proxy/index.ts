// Supabase Edge Function - HTTP Proxy
// Forwards HTTP requests to external APIs to bypass CORS restrictions

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Check if we should verify JWT (skip in local dev with --no-verify-jwt)
    const skipAuth = Deno.env.get("SKIP_AUTH") === "true";

    if (!skipAuth) {
      // Verify authentication
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "Missing authorization header" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify the JWT token with Supabase
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
        global: {
          headers: { Authorization: authHeader },
        },
      });

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired token" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Parse request body
    const body = await req.json();
    const { method, url, headers, body: requestBody, bodyType, formData, timeout = 30000 } = body;

    if (!url) {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build target URL
    let targetUrl = url;
    if (!targetUrl.match(/^https?:\/\//i)) {
      targetUrl = "http://" + targetUrl;
    }

    const startTime = Date.now();

    // Build headers
    const targetHeaders: Record<string, string> = {};
    if (Array.isArray(headers)) {
      for (const h of headers) {
        if (h.key && h.enabled !== false) {
          targetHeaders[h.key] = h.value;
        }
      }
    }

    // Build request options
    const fetchOptions: RequestInit = {
      method: method || "GET",
      headers: targetHeaders,
    };

    // Add body for methods that support it
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method?.toUpperCase())) {
      if (bodyType === "form-data" && Array.isArray(formData)) {
        const form = new FormData();
        for (const field of formData) {
          if (!field.key || field.enabled === false) continue;
          if (field.type === "file" && field.value) {
            // Convert base64 to blob
            const byteString = atob(field.value);
            const ab = new Uint8Array(byteString.length);
            for (let i = 0; i < byteString.length; i++) {
              ab[i] = byteString.charCodeAt(i);
            }
            const blob = new Blob([ab], { type: field.fileType || "application/octet-stream" });
            form.append(field.key, blob, field.fileName || "file");
          } else {
            form.append(field.key, field.value || "");
          }
        }
        fetchOptions.body = form;
      } else if (requestBody) {
        fetchOptions.body = requestBody;
      }
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    fetchOptions.signal = controller.signal;

    try {
      const response = await fetch(targetUrl, fetchOptions);
      clearTimeout(timeoutId);

      const endTime = Date.now();

      // Get response body
      let responseBody: unknown;
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        responseBody = await response.json();
      } else {
        responseBody = await response.text();
      }

      // Convert headers to array format
      const responseHeaders: Array<{ key: string; value: string }> = [];
      response.headers.forEach((value, key) => {
        responseHeaders.push({ key, value });
      });

      const result = {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseBody,
        time: endTime - startTime,
        size: JSON.stringify(responseBody).length,
      };

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      const endTime = Date.now();

      if (fetchError.name === "AbortError") {
        return new Response(
          JSON.stringify({
            status: 0,
            statusText: "Timeout",
            headers: [],
            body: `Request timed out after ${timeout}ms`,
            time: endTime - startTime,
            size: 0,
            error: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          status: 0,
          statusText: "Error",
          headers: [],
          body: fetchError.message,
          time: endTime - startTime,
          size: 0,
          error: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
