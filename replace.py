import re

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # /api/projects
    content = re.sub(
        r'const res = await fetch\(`\/api\/projects\?t=\$\{Date\.now\(\)\}`\);\s*const data = await res\.json\(\);',
        'const data = {projects: await window.api_invoke("get_project_list")};',
        content
    )

    # /api_deprecated/projects/active (load project)
    content = re.sub(
        r'const res = await fetch\(\'\/api_deprecated\/projects\/active\',\s*\{\s*method:\s*\'POST\',\s*headers:\s*\{\s*\'Content-Type\':\s*\'application\/json\'\s*\},\s*body:\s*JSON\.stringify\(\{filename\}\)\s*\}\);\s*const data = await res\.json\(\);',
        'const data = {status: "success", project: await window.api_invoke("load_project", {filename})};',
        content
    )

    # /api_deprecated/projects/create
    content = re.sub(
        r'const res = await fetch\(\'\/api_deprecated\/projects\/create\',\s*\{\s*method:\s*\'POST\',\s*headers:\s*\{\s*\'Content-Type\':\s*\'application\/json\'\s*\},\s*body:\s*JSON\.stringify\(\{title\}\)\s*\}\);\s*const data = await res\.json\(\);',
        'const data = {status: "success", message: await window.api_invoke("create_project", {title})};',
        content
    )

    # /api/project (get active)
    content = re.sub(
        r'const res = await fetch\(`\/api\/project\?t=\$\{Date\.now\(\)\}`\);\s*const data = await res\.json\(\);',
        'const data = await window.api_invoke("get_active_project");',
        content
    )

    # /api/locale
    content = re.sub(
        r'const res = await fetch\(`\/api\/locale\/\$\{lang\}`\);\s*const dict = await res\.json\(\);',
        'const dict = await window.api_invoke("get_locale", {lang});',
        content
    )

    # /api_deprecated/project (save)
    content = re.sub(
        r'const res = await fetch\(\'\/api_deprecated\/project\',\s*\{\s*method:\s*\'POST\',\s*headers:\s*\{\s*\'Content-Type\':\s*\'application\/json\'\s*\},\s*body:\s*JSON\.stringify\(projectData\)\s*\}\);\s*if \(!res\.ok\) throw new Error\(\'Save failed\'\);',
        'await window.api_invoke("update_project", {data: projectData});',
        content
    )

    content = re.sub(
        r'await fetch\(\'\/api_deprecated\/project\',\s*\{\s*method:\s*\'POST\',\s*headers:\s*\{\s*\'Content-Type\':\s*\'application\/json\'\s*\},\s*body:\s*JSON\.stringify\(projectData\)\s*\}\);',
        'await window.api_invoke("update_project", {data: projectData});',
        content
    )

    # /api_deprecated/projects/delete
    content = re.sub(
        r'const res = await fetch\(\'\/api_deprecated\/projects\/delete\',\s*\{\s*method:\s*\'POST\',\s*headers:\s*\{\s*\'Content-Type\':\s*\'application\/json\'\s*\},\s*body:\s*JSON\.stringify\(\{filename\}\)\s*\}\);\s*const data = await res\.json\(\);',
        'const data = await window.api_invoke("delete_project", {filename});',
        content
    )

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

process_file('ecriture-rust/static/js/moteur.js')
