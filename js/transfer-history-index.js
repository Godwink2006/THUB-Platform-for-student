function withTransferHistoryTimeout(promise, label) {
  let timeoutId;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out.`)), 3000);
    }),
  ]).finally(() => window.clearTimeout(timeoutId));
}

window.getStudentTransferHistoryIndex = async function (client = window.supabaseClient) {
  if (!client) throw new Error("Database client is unavailable.");

  const { data: { user }, error: userError } = await client.auth.getUser();
  if (userError || !user) throw userError || new Error("Sign in to view school records.");

  const cachedIndex = window.studentTransferHistoryIndex;
  if (cachedIndex?.userId === user.id) return cachedIndex;

  let transfers = [];
  try {
    const rpcResult = await withTransferHistoryTimeout(
      client.rpc("get_my_transfer_history"),
      "Transfer history lookup",
    );
    if (rpcResult.error) throw rpcResult.error;
    transfers = Array.isArray(rpcResult.data) ? rpcResult.data : [];
  } catch (error) {
    // Transfer history is supplementary. Do not let a missing/denied RPC block
    // current records, whose own table queries still enforce RLS and ownership.
    console.warn("Transfer history is unavailable; continuing with current-school records:", error);
  }

  let currentSchoolId = null;
  try {
    const { data: profile, error: profileError } = await withTransferHistoryTimeout(
      client.from("profiles").select("school_id").eq("id", user.id).single(),
      "School label lookup",
    );
    if (profileError) throw profileError;
    currentSchoolId = profile?.school_id
      ? String(profile.school_id).toLowerCase()
      : null;
  } catch (error) {
    // This lookup only labels historical rows; each page's student_id-filtered
    // query remains subject to the database's existing RLS policies.
    console.warn("Could not load the school label for transfer history:", error);
  }

  const index = {
    userId: user.id,
    transfers,
    currentSchoolId,
    recordIds: {
      attendance: new Set(),
      grade: new Set(),
      fee: new Set(),
      payment: new Set(),
    },
  };

  for (const transfer of currentSchoolId ? transfers : []) {
    if (currentSchoolId && String(transfer.source_school_id || "").toLowerCase() === currentSchoolId) continue;
    for (const record of Array.isArray(transfer.records) ? transfer.records : []) {
      const type = String(record.record_type || "").toLowerCase();
      const id = record.record_snapshot?.id || record.source_record_id;
      if (index.recordIds[type] && id != null) {
        index.recordIds[type].add(String(id));
      }
    }
  }

  window.studentTransferHistoryIndex = index;
  return index;
};
