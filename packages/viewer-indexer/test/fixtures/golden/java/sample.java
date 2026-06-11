package com.example.sample;

import java.util.List;
import java.util.Map;
import java.io.*;
import static java.lang.Math.PI;

// Exported class (public)
public class UserService {

    // Exported field
    public String serviceName;

    // Unexported field
    private int maxRetries;

    // Exported constructor
    public UserService(String name) {
        this.serviceName = name;
    }

    // Exported method
    public List<String> getUsers() {
        return List.of("Alice", "Bob");
    }

    // Unexported method
    private void logAccess(String user) {
        System.out.println(user);
    }

    // Nested static class
    public static class Config {
        public String url;
    }
}

// Exported interface (public)
public interface Repository {
    void save(Object entity);
    Object findById(int id);
}

// Exported enum (public)
public enum Status {
    ACTIVE,
    INACTIVE;

    // Method inside enum
    public String display() {
        return name().toLowerCase();
    }
}

// Unexported class (package-private)
class InternalHelper {
    void doWork() {}
}

// Exported annotation type
public @interface Cacheable {
}
