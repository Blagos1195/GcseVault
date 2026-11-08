ALTER TABLE users
ADD COLUMN role TEXT NOT NULL DEFAULT 'user'
CHECK (role IN ('user', 'admin', 'owner'));

CREATE UNIQUE INDEX users_single_owner
ON users(role)
WHERE role = 'owner';

CREATE INDEX users_role_idx ON users(role);
