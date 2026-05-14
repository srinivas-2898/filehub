-- Run this once in your Supabase SQL Editor (Dashboard → SQL Editor → New query)
--
-- Creates a security-definer function that allows an authenticated user
-- to delete their OWN account from auth.users. The function runs with
-- elevated privileges (postgres role) so it can touch auth schema,
-- but it is restricted to only delete the currently logged-in user.

CREATE OR REPLACE FUNCTION public.delete_user()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only allow deleting the caller's own account
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;

-- Grant execute permission to authenticated users only
REVOKE ALL ON FUNCTION public.delete_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_user() TO authenticated;
