# Positive delegated session fixture

Loaded skill: rolekit-adapter-pi

```
rolekit task compile tasks/mock-success.yaml --json
```

exit_code: 0

```
rolekit run start tasks/mock-success.yaml --json
```

exit_code: 0

```
rolekit run status run-fixture-001 --json
```

exit_code: 0

```
rolekit run collect run-fixture-001 --json
```

exit_code: 0

```
rolekit verify run-fixture-001 --json
```

exit_code: 0
