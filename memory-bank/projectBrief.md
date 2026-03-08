# Project Brief

## Project Name
Post Umbrella

## Business Context
A self-hosted, network-accessible API testing tool — similar to Postman but runs locally/on your own infrastructure. Enables teams to collaborate on API testing with real-time sync across users.

## Core Requirements
- Create and organize API requests in collections (folders)
- Send HTTP requests and view responses (with JSON formatting)
- Save request/response pairs as "Examples"
- Environment variables with substitution ({{variable}} syntax)
- Pre-request and post-response scripts (JavaScript)
- Import/export Postman collections (v2.1 format)
- Real-time sync across multiple users
- User authentication (multi-user support)

## Target Users
- Development teams who want a self-hosted Postman alternative
- Teams who need real-time collaboration on API testing
- Users who prefer not to use cloud-based API tools

## Success Criteria
- Users can create, send, and save API requests
- Changes sync in real-time across all connected users
- Collections can be imported from/exported to Postman format
- App runs reliably with minimal maintenance

## Constraints
- Must be hostable for free or minimal cost
- Should work with standard web hosting (no special infrastructure)
- Currently MySQL-dependent but migrating to PostgreSQL/Supabase
