package com.example.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * CleanUserService — a modern, well-written Java class.
 *
 * PURPOSE (for parser tests):
 *   This file should produce ZERO risk issues from the static parser.
 *   - Uses ArrayList (not Vector/Hashtable/Stack)
 *   - Uses generics throughout (no raw types, no unchecked casts)
 *   - Uses try-with-resources for any closeable resources
 *   - No deprecated annotations
 *   - No dangerous threading or process-exit anti-patterns
 *   - Nesting depth is shallow (< 5)
 *   - Has no TODO/FIXME comments
 */
public class CleanUserService {

    private final List<String> users;

    public CleanUserService() {
        this.users = new ArrayList<>();
    }

    public void addUser(String name) {
        if (name != null && !name.isBlank()) {
            users.add(name);
        }
    }

    public Optional<String> findUser(String name) {
        return users.stream()
                    .filter(u -> u.equals(name))
                    .findFirst();
    }

    public List<String> getAllUsers() {
        return List.copyOf(users);
    }

    public boolean removeUser(String name) {
        return users.remove(name);
    }
}
