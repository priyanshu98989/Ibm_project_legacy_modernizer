package com.example.legacy;

import java.util.Vector;
import java.util.Enumeration;
import java.util.Hashtable;
import java.util.Stack;
import java.io.FileInputStream;
import java.io.InputStream;

/**
 * MessyLegacyManager — deliberately broken/legacy-heavy Java file.
 *
 * PURPOSE (for parser tests):
 *   This file should trigger EVERY Java risk rule:
 *   - Vector, Hashtable, Stack, Enumeration (legacy collections)
 *   - Raw types (no generics)
 *   - Unchecked casts
 *   - Manual .close() without try-with-resources
 *   - Deep nesting
 *   - @Deprecated methods
 *   - Anti-patterns (Thread.sleep, catch Exception)
 *   - Multiple TODO/FIXME comments
 *   - No unit tests
 *
 * Also tests graceful failure: intentional syntax oddities
 * (unclosed strings in comments, deeply irregular nesting) that
 * should NOT crash the parser — just flag the file.
 */
@SuppressWarnings("all")
public class MessyLegacyManager {

    // Raw type declarations (no generics)
    private Vector users;
    private Hashtable cache;
    private Stack workStack;

    public MessyLegacyManager() {
        users     = new Vector();     // legacy collection
        cache     = new Hashtable();  // legacy collection
        workStack = new Stack();      // legacy collection
    }

    // TODO: replace Vector with ArrayList
    // FIXME: this method leaks resources
    // HACK: workaround for ancient API
    // TODO: add null check
    // FIXME: thread safety not handled

    @Deprecated
    public String findUser(String name) {
        // Unchecked cast — raw Enumeration
        Enumeration e = users.elements();
        while (e.hasMoreElements()) {
            String u = (String) e.nextElement(); // unchecked cast
            if (u != null) {
                if (u.equals(name)) {
                    if (!cache.containsKey(name)) {
                        if (workStack.size() < 100) {
                            cache.put(name, u); // deep nesting level 5+
                        }
                    }
                    return u;
                }
            }
        }
        return null;
    }

    @Deprecated
    public void loadFromFile(String path) {
        // Manual close without try-with-resources — resource leak risk
        InputStream is = null;
        try {
            is = new FileInputStream(path);
            // ... read data ...
        } catch (Exception ex) {    // anti-pattern: catch Exception
            ex.printStackTrace();
        } finally {
            try {
                if (is != null) is.close(); // manual close — should be try-with-resources
            } catch (Exception e) { /* swallowed */ }
        }
    }

    public void riskyThread() throws InterruptedException {
        Thread.sleep(1000);   // anti-pattern: Thread.sleep in business logic
        new Thread(() -> {    // anti-pattern: new Thread()
            System.exit(1);   // anti-pattern: System.exit
        }).start();
    }
}
