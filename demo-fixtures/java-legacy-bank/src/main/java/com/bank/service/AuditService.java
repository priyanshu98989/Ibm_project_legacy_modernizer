package com.bank.service;

import com.bank.model.Account;
import java.util.Hashtable;
import java.util.Vector;

/**
 * AuditService.java — Legacy audit trail implementation.
 * Deliberately uses legacy patterns: Hashtable, Vector, no generics, finalize().
 */
public class AuditService {

    private Hashtable auditLog;      // raw Hashtable<String, String>
    private Vector    eventQueue;    // raw Vector<String>

    public AuditService() {
        auditLog   = new Hashtable();
        eventQueue = new Vector();
    }

    public void logEvent(String key, String value) {
        auditLog.put(key, value);
        eventQueue.addElement(key + "=" + value);
    }

    public String getEvent(String key) {
        return (String) auditLog.get(key);   // unchecked cast
    }

    /**
     * @deprecated Use async event emitter instead.
     */
    @Deprecated
    public void flushLog() {
        java.util.Enumeration keys = auditLog.keys();
        while (keys.hasMoreElements()) {
            String k = (String) keys.nextElement();  // unchecked cast
            System.out.println("AUDIT: " + k + " = " + auditLog.get(k));
        }
    }

    /**
     * Legacy finalizer — explicitly deprecated JVM hook.
     * @deprecated Use try-with-resources or explicit close().
     */
    @Override
    @Deprecated
    protected void finalize() throws Throwable {
        auditLog.clear();
        eventQueue.clear();
        super.finalize();
    }
}
