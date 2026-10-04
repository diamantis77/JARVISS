-- Greek-first defaults for new settings only. Existing explicit preferences are preserved.
alter table public.settings alter column default_language set default 'el-GR';
