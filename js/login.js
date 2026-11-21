function togglePassword(id) {
  const input = document.getElementById(id);
  input.type = input.type === "password" ? "text" : "password";
}

const form = document.getElementById("loginForm");

async function redirectIfAlreadySignedIn() {
  const client = window.supabaseClient;
  if (!client?.auth) return;

  try {
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();
    if (userError) throw userError;
    if (!user) return;

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("role, status")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    if (!profile) {
      await client.auth.signOut();
      showToast("We couldn't find a student profile for this account. Contact your school administrator.", "error");
      return;
    }

    if (String(profile.role || "").trim().toLowerCase() !== "student") {
      await client.auth.signOut();
      showToast("This sign-in page is for student accounts. Use the login for your account type.", "error");
      return;
    }

    if (String(profile.status || "").trim().toLowerCase() !== "active") {
      await client.auth.signOut();
      showToast("Your student account is inactive. Contact your school administrator.", "error");
      return;
    }

    window.location.replace("/html/dashboard.html");
    return;
  } catch (error) {
    console.warn("Could not restore the signed-in user's role:", error);
  }

}

redirectIfAlreadySignedIn();

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const loginButton = form.querySelector(".login-btn");

  loginButton.disabled = true;
  loginButton.textContent = "Signing In...";

  try {
    const email = document.getElementById("email").value.trim().toLowerCase();
    const password = document.getElementById("password").value;

    const { data, error } = await window.supabaseClient.auth.signInWithPassword(
      {
        email,
        password,
      },
    );

    if (error) {
      throw error;
    }

    const {
      data: { session },
      error: sessionError,
    } = await window.supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;

    if (!session) {
      throw new Error("No session found.");
    }

    const { data: profile, error: profileError } = await window.supabaseClient
      .from("profiles")
      .select("role, status")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError) {
      console.error(profileError);
      throw profileError;
    }

    if (!profile) {
      await window.supabaseClient.auth.signOut();
      throw new Error(
        "We couldn't load your student profile. Contact your school administrator to check your account.",
      );
    }

    if (String(profile.role || "").trim().toLowerCase() !== "student") {
      await window.supabaseClient.auth.signOut();
      throw new Error("This app is for student accounts. Sign in with a student account.");
    }

    if (String(profile.status || "").trim().toLowerCase() !== "active") {
      await window.supabaseClient.auth.signOut();
      throw new Error(
        "Your student account is inactive. Contact your school administrator.",
      );
    }

    window.location.replace("/html/dashboard.html");
  } catch (err) {
    showToast(err.message, "error");
    console.error(err);
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Sign In";
  }
});
