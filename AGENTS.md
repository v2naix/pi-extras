# Repository instructions

## Isolated testing commands

After adding or modifying a Pi skill in this repository, end the final response with a copy-pasteable isolated test command for each affected skill:

```bash
pi --no-skills --skill ~/.pi/pi-extras/skills/<skill-name>
```

Replace `<skill-name>` with the actual skill directory name. Keep the test command at the very bottom of the response.

For extension changes, use the analogous isolated form:

```bash
pi --no-extensions -e ~/.pi/pi-extras/extensions/<extension-file>.ts
```
