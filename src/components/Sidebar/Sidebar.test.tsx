import React from "react";
import { MemoryRouter } from "react-router-dom";
import Sidebar from "./Sidebar";
import ConferenceContext from "../../contexts/ConferenceContext";
import { Conference } from "../../classes/DataLayer";
import { render } from "@testing-library/react";

const MockConference: Conference = new Conference("mock_conference_id", {
    adminEmail: "mock_adminEmail",
    adminName: "mock_adminName",
    createdAt: new Date(),
    conferenceName: "mock_conferenceName",
    headerImage: null,
    id: "mock_id",
    isInitialized: false,
    landingPage: "mock_landingPage",
    updatedAt: new Date(),
    welcomeText: "mock_welcomeText"
});

describe("Sidebar", () => {
    it("requires a conference", () => {
        // Avoid printing the error to the console
        let error = jest.spyOn(console, 'error');
        error.mockImplementation(() => { });

        expect(() => render(<Sidebar />))
            .toThrow("Conference should be defined.");

        error.mockRestore();
    });

    it("renders with class name 'sidebar'", () => {
        let element = render(<MemoryRouter>
                <ConferenceContext.Provider value={MockConference}>
                    <Sidebar />
                </ConferenceContext.Provider>
            </MemoryRouter>);

        expect(element.container.children[0].className).toBe("sidebar");
    });
});
