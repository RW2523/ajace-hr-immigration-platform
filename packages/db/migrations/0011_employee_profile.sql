-- 0011_employee_profile.sql
-- Extended profile attributes (DOB, birthplace, passport, education, addresses,
-- contact) as a flexible JSONB blob so the rich profile view can render them
-- without a wide column set. Sensitive identifiers (SSN) stay in employee_ssn.
alter table app.employees add column if not exists profile jsonb not null default '{}'::jsonb;
