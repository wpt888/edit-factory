"""
Migration script pentru job_storage în routes.py.
Convertește toate referințele de la jobs_store dict la JobStorage service.
"""
import re
from pathlib import Path


def migrate_routes_file():
    """Migrează routes.py la noul JobStorage."""

    routes_file = Path(__file__).parent.parent / "app" / "api" / "routes.py"

    if not routes_file.exists():
        print(f"ERROR: {routes_file} not found!")
        return

    content = routes_file.read_text(encoding='utf-8')
    original = content

    # Pattern 1: jobs_store[job_id] = job → job_storage.create_job(job)
    # Dar trebuie să detectăm contextul - create vs update

    # Pattern 2: job = jobs_store.get(job_id) → job = job_storage.get_job(job_id)
    content = re.sub(
        r'job\s*=\s*jobs_store\.get\(job_id\)',
        'job = job_storage.get_job(job_id)',
        content
    )

    # Pattern 3: for j in jobs_store.values() → for j in job_storage.list_jobs()
    content = re.sub(
        r'for\s+(\w+)\s+in\s+jobs_store\.values\(\)',
        r'for \1 in job_storage.list_jobs()',
        content
    )

    # Pattern 4: del jobs_store[job_id] → job_storage.delete_job(job_id)
    content = re.sub(
        r'del\s+jobs_store\[job_id\]',
        'job_storage.delete_job(job_id)',
        content
    )

    # Pattern 5: Adaugă get_job_storage() la începutul fiecărei funcții care folosește jobs_store
    # Căutăm funcții cu jobs_store în ele
    function_pattern = r'(async def|def)\s+(\w+)\([^)]*\):([^}]*jobs_store)'

    def add_job_storage(match):
        func_type = match.group(1)
        func_name = match.group(2)
        func_body = match.group(3)

        # Nu adăugăm dacă deja există
        if 'job_storage = get_job_storage()' in func_body:
            return match.group(0)

        # Găsim primul rând după : (sau după """docstring""")
        lines = func_body.split('\n')
        insert_index = 0

        # Skip docstring dacă există
        in_docstring = False
        for i, line in enumerate(lines):
            stripped = line.strip()
            if '"""' in stripped or "'''" in stripped:
                in_docstring = not in_docstring
            elif not in_docstring and stripped and not stripped.startswith('#'):
                insert_index = i
                break

        # Inserăm la început
        indent = '    '
        job_storage_line = f'\n{indent}job_storage = get_job_storage()'

        lines.insert(insert_index, job_storage_line)
        new_body = '\n'.join(lines)

        return f'{func_type} {func_name}():{new_body}'

    # Nu aplicăm regex complex - prea riscant
    # În schimb, printăm instrucțiuni manuale

    if content != original:
        # Backup
        backup_file = routes_file.with_suffix('.py.bak')
        backup_file.write_text(original, encoding='utf-8')
        print(f"✅ Backup creat: {backup_file}")

        # Scriem noua versiune
        routes_file.write_text(content, encoding='utf-8')
        print(f"✅ Migrat {routes_file}")
        print("\nSchimbări:")
        print("  - jobs_store.get() → job_storage.get_job()")
        print("  - jobs_store.values() → job_storage.list_jobs()")
        print("  - del jobs_store[job_id] → job_storage.delete_job(job_id)")

        print("\n⚠️  MANUAL STEPS NEEDED:")
        print("  1. Înlocuiește jobs_store[job_id] = job cu:")
        print("     - job_storage.create_job(job) pentru job-uri noi")
        print("  2. Adaugă 'job_storage = get_job_storage()' la începutul fiecărei funcții")
        print("  3. Înlocuiește job['field'] = value cu job_storage.update_job(job_id, {'field': value})")
    else:
        print("ℹ️  No changes needed (already migrated)")


if __name__ == "__main__":
    migrate_routes_file()
